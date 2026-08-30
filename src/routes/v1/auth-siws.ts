import type { FastifyPluginAsync } from "fastify";
import { randomBytes } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { config } from "../../config/env.js";
import { getRedisClient } from "../../lib/redisClient.js";
import { signJwt } from "../../utils/jwt.js";

/**
 * Sign-In With Stellar.
 *
 * The user signs a plain message with their wallet; the server verifies the
 * Ed25519 signature against the claimed public key. No transaction is built,
 * which is what distinguishes this from the SEP-10 flow in src/routes/sep010.ts.
 *
 * Both exist deliberately and are mounted at different paths — SEP-10 at
 * /auth/* for ecosystem clients that expect a challenge transaction and a
 * stellar.toml WEB_AUTH_ENDPOINT, this at /api/v1/auth/* for first-party
 * callers. See the note on issue #3.
 */

const NONCE_TTL_SECONDS = 300;
const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Fallback nonce store for when REDIS_URL is unset.
 *
 * Process-local, so replay protection does not hold across instances — a
 * nonce consumed on one worker is still spendable on another. Acceptable for
 * local development, which is the only place it should be reached; the same
 * fallback pattern is used by the rate limiter in src/index.ts.
 */
const memoryNonces = new Map<string, number>();

function memoryKeyFor(address: string, nonce: string) {
  return `${address}:${nonce}`;
}

function sweepMemory(now: number) {
  for (const [key, expiresAt] of memoryNonces) {
    if (expiresAt <= now) memoryNonces.delete(key);
  }
}

async function storeNonce(address: string, nonce: string, expiresAt: number): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    await redis.set(`siws:nonce:${address}:${nonce}`, "1", "EX", NONCE_TTL_SECONDS);
    return;
  }
  sweepMemory(Date.now());
  memoryNonces.set(memoryKeyFor(address, nonce), expiresAt);
}

/**
 * Consumes a nonce, returning whether it was present.
 *
 * The read and the delete must be one operation: two callers racing a
 * GET/DEL pair could both observe the nonce and both be issued a token, which
 * is the replay this is here to prevent. GETDEL is atomic; the in-memory
 * fallback is single-threaded, so its delete-after-read is too.
 */
async function consumeNonce(address: string, nonce: string): Promise<boolean> {
  const redis = getRedisClient();
  if (redis) {
    const key = `siws:nonce:${address}:${nonce}`;
    const value = await redis.getdel(key);
    return value !== null;
  }

  const key = memoryKeyFor(address, nonce);
  const expiresAt = memoryNonces.get(key);
  memoryNonces.delete(key);
  return expiresAt !== undefined && expiresAt > Date.now();
}

/** The exact bytes the wallet is asked to sign. */
export function buildSiwsMessage(address: string, nonce: string, issuedAt: Date, expiresAt: Date) {
  return [
    `${config.sep10HomeDomain} wants you to sign in with your Stellar account:`,
    address,
    "",
    "Sign this message to authenticate. It grants no on-chain authority and",
    "moves no funds.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}

/** Pulls the nonce back out of a signed message, so it can be consumed. */
function nonceFromMessage(message: string): string | undefined {
  const line = message.split("\n").find((l) => l.startsWith("Nonce: "));
  return line?.slice("Nonce: ".length).trim() || undefined;
}

function expiryFromMessage(message: string): Date | undefined {
  const line = message.split("\n").find((l) => l.startsWith("Expiration Time: "));
  if (!line) return undefined;
  const parsed = new Date(line.slice("Expiration Time: ".length).trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export const siwsAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auth/challenge", async (req, reply) => {
    const { address } = req.query as { address?: string };
    if (!address) return reply.status(400).send({ error: "address required" });
    if (!StrKey.isValidEd25519PublicKey(address)) {
      return reply.status(400).send({ error: "address is not a valid Stellar public key" });
    }

    const nonce = randomBytes(24).toString("base64url");
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_SECONDS * 1000);

    await storeNonce(address, nonce, expiresAt.getTime());

    return {
      nonce,
      message: buildSiwsMessage(address, nonce, issuedAt, expiresAt),
      expiresAt: expiresAt.toISOString(),
    };
  });

  app.post("/auth/verify", async (req, reply) => {
    const { address, signature, message } = (req.body ?? {}) as {
      address?: string;
      signature?: string;
      message?: string;
    };

    if (!address || !signature || !message) {
      return reply.status(400).send({ error: "address, message and signature are required" });
    }
    if (!StrKey.isValidEd25519PublicKey(address)) {
      return reply.status(400).send({ error: "address is not a valid Stellar public key" });
    }

    // Check the message's own expiry before spending the nonce, so an expired
    // attempt does not burn a nonce the user could still legitimately use.
    const expiresAt = expiryFromMessage(message);
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      return reply.status(401).send({ error: "challenge has expired" });
    }

    const nonce = nonceFromMessage(message);
    if (!nonce) return reply.status(400).send({ error: "message is missing a nonce" });

    let verified: boolean;
    try {
      verified = Keypair.fromPublicKey(address).verify(
        Buffer.from(message, "utf8"),
        Buffer.from(signature, "base64"),
      );
    } catch {
      // A malformed signature is a failed authentication, not a server error.
      verified = false;
    }
    if (!verified) {
      return reply.status(401).send({ error: "signature does not match address" });
    }

    // Consumed only after the signature checks out. Doing it earlier would let
    // an attacker invalidate someone else's outstanding challenge by posting
    // the message with a junk signature.
    const consumed = await consumeNonce(address, nonce);
    if (!consumed) {
      return reply.status(401).send({ error: "challenge is unknown, expired, or already used" });
    }

    const now = Math.floor(Date.now() / 1000);
    const accessToken = signJwt(
      { sub: address, address, role: "user", iat: now, exp: now + ACCESS_TTL_SECONDS },
      config.jwtSecret,
    );
    const refreshToken = signJwt(
      { sub: address, address, typ: "refresh", iat: now, exp: now + REFRESH_TTL_SECONDS },
      config.jwtSecret,
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
    };
  });
};
