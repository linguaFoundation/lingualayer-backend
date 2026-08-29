import type { FastifyPluginAsync } from "fastify";
import {
  getCommissionById,
  upsertCommission,
  listCommissions,
  type CommissionState,
} from "../../services/commission-indexer.js";
import { sendCommissionFulfilmentEmail } from "../../services/notifications.js";

const VALID_STATES: CommissionState[] = ["open", "fulfilled", "cancelled"];
import { z } from "zod";
import {
  BASE_FEE,
  Contract,
  Horizon,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const DATA_COMMISSION_CONTRACT_ID = process.env.DATA_COMMISSION_CONTRACT_ID;
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";

const prepareBodySchema = z.object({
  commissioner: z.string(),
  language_code: z.string(),
  bounty_amount_usdc: z.number().positive(),
  description_markdown: z.string(),
  min_sample_count: z.number().int().positive(),
  min_duration_hours: z.number().int().positive(),
  deadline_days: z.number().int().positive(),
});

/** Uploads markdown to an IPFS node's HTTP API and returns the resulting CID. */
async function uploadDescriptionToIPFS(markdown: string): Promise<string> {
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

export const commissionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/commissions", async (req, reply) => {
    const { state, page = "1", limit = "20" } = req.query as Record<string, string>;

    if (state && !VALID_STATES.includes(state as CommissionState)) {
      return reply.status(400).send({ error: `state must be one of: ${VALID_STATES.join(", ")}` });
    }

    return listCommissions({
      state: state as CommissionState | undefined,
      page: Math.max(parseInt(page, 10) || 1, 1),
      limit: Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100),
    });
  });

  app.get("/commissions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const commission = getCommissionById(id);
    if (!commission) {
      return reply.status(404).send({ error: "commission not found" });
    }
    return commission;
  });

  app.post("/commissions/:id/fulfil", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { notifyEmail } = (req.body ?? {}) as { notifyEmail?: string };

    const commission = getCommissionById(id);
    if (!commission) {
      return reply.status(404).send({ error: "commission not found" });
    }
    if (commission.state === "fulfilled") {
      return reply.status(409).send({ error: "commission already fulfilled" });
    }

    const fulfilled = { ...commission, state: "fulfilled" as const };
    upsertCommission(fulfilled);

    let emailSent = false;
    if (notifyEmail) {
      emailSent = await sendCommissionFulfilmentEmail(notifyEmail, fulfilled);
    }

    return { commission: fulfilled, emailSent };
  });

  app.post("/commissions/prepare", async (req, reply) => {
    const parsed = prepareBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWTTCJM4RFCKMMGNEQ3C7OQ72N7K6O4LUKXP";
    const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

    let account;
    try {
      account = await horizon.loadAccount(body.commissioner);
    } catch (e: any) {
      if (e.response && e.response.status === 404) {
        return reply.status(404).send({ error: "Commissioner account not found" });
      }
      throw e;
    }

    const usdcBalance = account.balances.find(
      (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
    );
    if (!usdcBalance || parseFloat(usdcBalance.balance) < body.bounty_amount_usdc) {
      return reply.status(422).send({
        error: `Insufficient USDC: need ${body.bounty_amount_usdc}, have ${usdcBalance?.balance ?? 0}`,
      });
    }

    if (!DATA_COMMISSION_CONTRACT_ID) {
      return reply.status(500).send({ error: "DATA_COMMISSION_CONTRACT_ID is not configured" });
    }

    const descriptionCid = await uploadDescriptionToIPFS(body.description_markdown);

    const server = new rpc.Server(SOROBAN_RPC_URL);
    const sourceAccount = await server.getAccount(body.commissioner);
    const contract = new Contract(DATA_COMMISSION_CONTRACT_ID);

    const op = contract.call(
      "post_commission",
      nativeToScVal(body.commissioner, { type: "address" }),
      nativeToScVal(body.language_code, { type: "symbol" }),
      nativeToScVal(Math.round(body.bounty_amount_usdc * 1e7), { type: "i128" }),
      nativeToScVal(descriptionCid, { type: "bytes" }),
      nativeToScVal(body.min_sample_count, { type: "u32" }),
      nativeToScVal(body.min_duration_hours, { type: "u32" }),
      nativeToScVal(body.deadline_days, { type: "u32" })
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

    return {
      xdr: tx.toXDR(),
      simulation: {
        fee: sim.minResourceFee,
        instructions: sim.transactionData.build().resources().instructions(),
      },
    };
  });
};
