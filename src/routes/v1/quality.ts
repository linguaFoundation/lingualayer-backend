import type { FastifyPluginAsync } from "fastify";
import { qualityOracleAttestationsTotal } from "../../metrics.js";
import { getLeaderboard, recordAttestation } from "../../services/curator-stats.js";
import { z } from "zod";
import {
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const QUALITY_ORACLE_CONTRACT_ID = process.env.QUALITY_ORACLE_CONTRACT_ID;
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";

const prepareBodySchema = z.object({
  curator_address: z.string(),
  dataset_id: z.string(),
  score: z.number().int().min(0).max(100),
  rubric_markdown: z.string(),
});

/** Uploads markdown to an IPFS node's HTTP API and returns the resulting CID. */
async function uploadRubricToIPFS(markdown: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([markdown], { type: "text/markdown" }));

  const res = await fetch(`${IPFS_API_URL}/api/v0/add?pin=true`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`IPFS upload failed: ${res.status} ${res.statusText}`);
  }
  const { Hash } = (await res.json()) as { Hash: string };
  return Hash;
}

/**
 * A CIDv0/v1 string doesn't fit a contract's `BytesN<32>` parameter as-is -
 * this embeds its SHA-256 digest instead, the common pattern for anchoring a
 * variable-length identifier into a fixed-size on-chain field. The rubric
 * itself is fetched from IPFS by CID off-chain; the contract only needs a
 * fixed-size, tamper-evident commitment to it.
 */
function cidToBytes32(cid: string): Buffer {
  return createHash("sha256").update(cid).digest();
}

export const qualityRoutes: FastifyPluginAsync = async (app) => {
  app.get("/datasets/:id/quality", async (req) => {
    const { id } = req.params as { id: string };
    // TODO: query QualityOracle contract + local DB cache
    return {
      dataset_id: id,
      average_score: 0,
      attestation_count: 0,
      tier: "Unrated",
      royalty_multiplier_bps: 10000,
    };
  });

  app.post("/quality/attest/prepare", async (req, reply) => {
    const parsed = prepareBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    if (!QUALITY_ORACLE_CONTRACT_ID) {
      return reply.status(500).send({ error: "QUALITY_ORACLE_CONTRACT_ID is not configured" });
    }

    const server = new rpc.Server(SOROBAN_RPC_URL);
    const contract = new Contract(QUALITY_ORACLE_CONTRACT_ID);

    // Curator registration check: a read-only simulated call to the
    // contract's `is_curator` view. Any curator-address argument shape
    // mismatch with the deployed contract's actual ABI should surface here
    // as a simulation error, which we treat conservatively as "not
    // registered" rather than risk a false positive.
    let sourceAccount;
    try {
      sourceAccount = await server.getAccount(body.curator_address);
    } catch {
      return reply.status(404).send({ error: "Curator account not found" });
    }

    const checkTx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("is_curator", nativeToScVal(body.curator_address, { type: "address" })))
      .setTimeout(30)
      .build();

    const checkSim = await server.simulateTransaction(checkTx);
    const isRegistered =
      !rpc.Api.isSimulationError(checkSim) &&
      checkSim.result?.retval !== undefined &&
      Boolean(checkSim.result.retval.value());

    if (!isRegistered) {
      return reply.status(409).send({ error: "Curator is not registered" });
    }

    const rubricCid = await uploadRubricToIPFS(body.rubric_markdown);
    const rubricDigest = cidToBytes32(rubricCid);

    const op = contract.call(
      "attest_quality",
      nativeToScVal(body.curator_address, { type: "address" }),
      nativeToScVal(body.dataset_id, { type: "symbol" }),
      nativeToScVal(body.score, { type: "u32" }),
      nativeToScVal(rubricDigest, { type: "bytes" })
    );

    let tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      return reply.status(422).send({ error: "Simulation failed", details: sim.error });
    }

    tx = rpc.assembleTransaction(tx, sim).build();

    qualityOracleAttestationsTotal.inc();
    recordAttestation(body.curator_address, body.score);

    return { xdr: tx.toXDR() };
  });

  app.get("/quality/leaderboard", async (req) => {
    const { limit = "20" } = req.query as Record<string, string>;
    return { curators: getLeaderboard(Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)) };
  });
};
