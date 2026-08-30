import test from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import { Keypair } from "@stellar/stellar-sdk";
import { siwsAuthRoutes } from "./auth-siws.js";

async function buildApp() {
  const app = Fastify();
  await app.register(siwsAuthRoutes);
  return app;
}

/** Runs a full challenge -> sign -> verify round trip. */
async function authenticate(app: Awaited<ReturnType<typeof buildApp>>, kp: Keypair) {
  const challenge = await app.inject({
    method: "GET",
    url: `/auth/challenge?address=${kp.publicKey()}`,
  });
  const { message } = challenge.json();
  const signature = kp.sign(Buffer.from(message, "utf8")).toString("base64");

  return app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { address: kp.publicKey(), message, signature },
  });
}

test("GET /auth/challenge returns a nonce, message and expiry", async () => {
  const app = await buildApp();
  const kp = Keypair.random();

  const res = await app.inject({
    method: "GET",
    url: `/auth/challenge?address=${kp.publicKey()}`,
  });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.nonce);
  assert.ok(body.message.includes(kp.publicKey()));
  assert.ok(body.message.includes(`Nonce: ${body.nonce}`));

  // Five minutes, per the issue. Allow a little slack for execution time.
  const ttlMs = new Date(body.expiresAt).getTime() - Date.now();
  assert.ok(ttlMs > 4 * 60 * 1000, `expiry too soon: ${ttlMs}ms`);
  assert.ok(ttlMs <= 5 * 60 * 1000 + 5_000, `expiry too far out: ${ttlMs}ms`);
});

test("GET /auth/challenge rejects a missing or malformed address", async () => {
  const app = await buildApp();

  assert.strictEqual((await app.inject({ method: "GET", url: "/auth/challenge" })).statusCode, 400);
  assert.strictEqual(
    (await app.inject({ method: "GET", url: "/auth/challenge?address=nope" })).statusCode,
    400,
  );
});

test("issues a token for a correctly signed challenge", async () => {
  const app = await buildApp();
  const kp = Keypair.random();

  const res = await authenticate(app, kp);

  assert.strictEqual(res.statusCode, 200, res.payload);
  const body = res.json();
  assert.ok(body.access_token);
  assert.ok(body.refresh_token);
  assert.strictEqual(body.token_type, "Bearer");

  const claims = JSON.parse(
    Buffer.from(body.access_token.split(".")[1], "base64url").toString("utf8"),
  );
  assert.strictEqual(claims.address, kp.publicKey());
  assert.strictEqual(claims.role, "user");
  assert.ok(claims.exp > Math.floor(Date.now() / 1000));
});

test("a nonce cannot be replayed", async () => {
  const app = await buildApp();
  const kp = Keypair.random();

  const challenge = await app.inject({
    method: "GET",
    url: `/auth/challenge?address=${kp.publicKey()}`,
  });
  const { message } = challenge.json();
  const signature = kp.sign(Buffer.from(message, "utf8")).toString("base64");
  const payload = { address: kp.publicKey(), message, signature };

  const first = await app.inject({ method: "POST", url: "/auth/verify", payload });
  assert.strictEqual(first.statusCode, 200);

  // Same message, same valid signature — the nonce is spent, so this is the
  // replay the flow exists to stop.
  const second = await app.inject({ method: "POST", url: "/auth/verify", payload });
  assert.strictEqual(second.statusCode, 401);
});

test("rejects a signature from a different key", async () => {
  const app = await buildApp();
  const kp = Keypair.random();
  const impostor = Keypair.random();

  const challenge = await app.inject({
    method: "GET",
    url: `/auth/challenge?address=${kp.publicKey()}`,
  });
  const { message } = challenge.json();

  const res = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: {
      address: kp.publicKey(),
      message,
      signature: impostor.sign(Buffer.from(message, "utf8")).toString("base64"),
    },
  });

  assert.strictEqual(res.statusCode, 401);
});

test("rejects a tampered message", async () => {
  const app = await buildApp();
  const kp = Keypair.random();

  const challenge = await app.inject({
    method: "GET",
    url: `/auth/challenge?address=${kp.publicKey()}`,
  });
  const { message } = challenge.json();
  const signature = kp.sign(Buffer.from(message, "utf8")).toString("base64");

  const res = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { address: kp.publicKey(), message: message + "\nGrant: admin", signature },
  });

  assert.strictEqual(res.statusCode, 401);
});

test("rejects an expired challenge", async () => {
  const app = await buildApp();
  const kp = Keypair.random();

  // Hand-built with an expiry in the past. The signature is valid for these
  // bytes, so this isolates the expiry check from signature verification.
  const past = new Date(Date.now() - 60_000).toISOString();
  const message = [
    "lingualayer.app wants you to sign in with your Stellar account:",
    kp.publicKey(),
    "",
    "Nonce: deadbeef",
    `Expiration Time: ${past}`,
  ].join("\n");

  const res = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: {
      address: kp.publicKey(),
      message,
      signature: kp.sign(Buffer.from(message, "utf8")).toString("base64"),
    },
  });

  assert.strictEqual(res.statusCode, 401);
});

test("rejects a nonce this server never issued", async () => {
  const app = await buildApp();
  const kp = Keypair.random();

  const future = new Date(Date.now() + 120_000).toISOString();
  const message = [
    "lingualayer.app wants you to sign in with your Stellar account:",
    kp.publicKey(),
    "",
    "Nonce: not-a-nonce-we-issued",
    `Expiration Time: ${future}`,
  ].join("\n");

  const res = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: {
      address: kp.publicKey(),
      message,
      signature: kp.sign(Buffer.from(message, "utf8")).toString("base64"),
    },
  });

  assert.strictEqual(res.statusCode, 401);
});

test("a failed verification does not burn the nonce", async () => {
  const app = await buildApp();
  const kp = Keypair.random();
  const impostor = Keypair.random();

  const challenge = await app.inject({
    method: "GET",
    url: `/auth/challenge?address=${kp.publicKey()}`,
  });
  const { message } = challenge.json();

  // Someone else posts the message with a junk signature. If that consumed
  // the nonce, anyone could invalidate an outstanding challenge at will.
  const attack = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: {
      address: kp.publicKey(),
      message,
      signature: impostor.sign(Buffer.from(message, "utf8")).toString("base64"),
    },
  });
  assert.strictEqual(attack.statusCode, 401);

  const legitimate = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: {
      address: kp.publicKey(),
      message,
      signature: kp.sign(Buffer.from(message, "utf8")).toString("base64"),
    },
  });
  assert.strictEqual(legitimate.statusCode, 200, "the real owner should still be able to sign in");
});

test("POST /auth/verify requires all three fields", async () => {
  const app = await buildApp();
  const kp = Keypair.random();

  const res = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { address: kp.publicKey() },
  });

  assert.strictEqual(res.statusCode, 400);
});
