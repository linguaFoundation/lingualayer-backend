import type { FastifyPluginAsync } from "fastify";
import { Keypair, Transaction, Networks } from "@stellar/stellar-sdk";

const SERVER_KEYPAIR = Keypair.random(); // TODO: load from env
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === "mainnet"
  ? Networks.PUBLIC : Networks.TESTNET;

export const sep010Routes: FastifyPluginAsync = async (app) => {
  // SEP-0010 challenge endpoint
  app.get("/auth/challenge", async (req) => {
    const { address } = req.query as { address: string };
    if (!address) throw app.httpErrors.badRequest("address required");

    const nonce = Math.random().toString(36).slice(2);
    // Build SEP-0010 challenge transaction
    // In production: use stellar-sdk TransactionBuilder with manage_data op
    return {
      transaction: "",   // XDR of challenge tx
      network_passphrase: NETWORK_PASSPHRASE,
    };
  });

  // SEP-0010 token endpoint
  app.post("/auth/token", async (req) => {
    const { transaction } = req.body as { transaction: string };
    // Verify the signed challenge transaction
    // Check signature matches the claimed public key
    // Issue JWT on success
    return {
      token: "",        // JWT
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
  });
};
