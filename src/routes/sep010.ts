import type { FastifyPluginAsync } from "fastify";
import { Keypair, Networks, WebAuth } from "@stellar/stellar-sdk";
import { config } from "../config/env.js";
import { signJwt } from "../utils/jwt.js";

// Falls back to an ephemeral random keypair when SEP10_SERVER_SECRET isn't
// set so the service still boots in dev, but tokens issued by one process
// won't verify against another — set the env var for anything but local dev.
const SERVER_KEYPAIR = config.sep10ServerSecret
  ? Keypair.fromSecret(config.sep10ServerSecret)
  : Keypair.random();

const NETWORK_PASSPHRASE =
  config.stellarNetwork === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

export const sep010Routes: FastifyPluginAsync = async (app) => {
  // SEP-0010 challenge endpoint.
  //
  // The challenge transaction is built with the SDK's WebAuth helper rather
  // than assembled by hand: it owns the operation layout, the fictitious
  // sequence number, and the timebounds that `readChallengeTx` will later
  // check, so hand-rolling the same structure invites the two to drift.
  app.get("/auth/challenge", async (req, reply) => {
    const { account } = req.query as { account?: string };
    if (!account) return reply.status(400).send({ error: "account required" });

    let transaction: string;
    try {
      transaction = WebAuth.buildChallengeTx(
        SERVER_KEYPAIR,
        account,
        config.sep10HomeDomain,
        config.sep10ChallengeTimeoutSeconds,
        NETWORK_PASSPHRASE,
        config.sep10WebAuthDomain,
      );
    } catch (err) {
      req.log.error(err, "failed to build SEP-10 challenge transaction");
      return reply.status(400).send({ error: "invalid account" });
    }

    return {
      transaction,
      network_passphrase: NETWORK_PASSPHRASE,
    };
  });

  // SEP-0010 token endpoint
  app.post("/auth/token", async (req, reply) => {
    const { transaction } = (req.body ?? {}) as { transaction?: string };
    if (!transaction) {
      return reply.status(400).send({ error: "transaction required" });
    }

    let clientAccountID: string;
    try {
      const { clientAccountID: parsedClientAccountID } = WebAuth.readChallengeTx(
        transaction,
        SERVER_KEYPAIR.publicKey(),
        NETWORK_PASSPHRASE,
        [config.sep10HomeDomain],
        config.sep10WebAuthDomain,
      );
      clientAccountID = parsedClientAccountID;

      // Full signature validation: confirms the server's own signature is
      // present (challenge wasn't forged) AND that the claimed client
      // account signed it too — a challenge that only carries the server's
      // signature (i.e. was never actually presented to the wallet) is
      // rejected here.
      WebAuth.verifyChallengeTxSigners(
        transaction,
        SERVER_KEYPAIR.publicKey(),
        NETWORK_PASSPHRASE,
        [clientAccountID],
        [config.sep10HomeDomain],
        config.sep10WebAuthDomain,
      );
    } catch (err) {
      req.log.warn(err, "SEP-10 challenge verification failed");
      return reply.status(401).send({ error: "invalid or unsigned challenge transaction" });
    }

    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(
      {
        sub: clientAccountID,
        iat: now,
        exp: now + config.jwtTtlSeconds,
      },
      config.jwtSecret,
    );

    return {
      token,
      expires_at: now + config.jwtTtlSeconds,
    };
  });
};
