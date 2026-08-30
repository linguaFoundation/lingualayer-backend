import test from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import { Keypair, Networks, Transaction } from "@stellar/stellar-sdk";
import { sep010Routes } from "./sep010.js";

async function buildApp() {
  const app = Fastify();
  await app.register(sep010Routes);
  return app;
}

test("GET /auth/challenge returns a signed challenge transaction", async () => {
  const app = await buildApp();
  const client = Keypair.random();

  const res = await app.inject({
    method: "GET",
    url: `/auth/challenge?account=${client.publicKey()}`,
  });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.transaction);
  assert.ok(body.network_passphrase);
});

test("GET /auth/challenge rejects a missing account", async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/auth/challenge" });

  assert.strictEqual(res.statusCode, 400);
});

test("GET /auth/challenge rejects an account that is not a public key", async () => {
  const app = await buildApp();

  const res = await app.inject({
    method: "GET",
    url: "/auth/challenge?account=not-a-stellar-address",
  });

  assert.strictEqual(res.statusCode, 400);
});

test("POST /auth/token issues a token for a correctly-signed challenge", async () => {
  const app = await buildApp();
  const client = Keypair.random();

  const challengeRes = await app.inject({
    method: "GET",
    url: `/auth/challenge?account=${client.publicKey()}`,
  });
  const { transaction, network_passphrase } = challengeRes.json();

  // The server signed it when issuing the challenge; add the client's.
  const tx = new Transaction(transaction, network_passphrase);
  tx.sign(client);

  const tokenRes = await app.inject({
    method: "POST",
    url: "/auth/token",
    payload: { transaction: tx.toXDR() },
  });

  assert.strictEqual(tokenRes.statusCode, 200, tokenRes.payload);
  const body = tokenRes.json();
  assert.strictEqual(body.token.split(".").length, 3);
  assert.ok(body.expires_at > Math.floor(Date.now() / 1000));

  // The token must name the account that actually signed, not the one the
  // caller asked a challenge for.
  const claims = JSON.parse(
    Buffer.from(body.token.split(".")[1], "base64url").toString("utf8"),
  );
  assert.strictEqual(claims.sub, client.publicKey());
});

test("POST /auth/token rejects a challenge the client never signed", async () => {
  const app = await buildApp();
  const client = Keypair.random();

  const challengeRes = await app.inject({
    method: "GET",
    url: `/auth/challenge?account=${client.publicKey()}`,
  });
  const { transaction } = challengeRes.json();

  // Returned unmodified: it carries only the server's signature, which is
  // what a forged or replayed challenge looks like.
  const tokenRes = await app.inject({
    method: "POST",
    url: "/auth/token",
    payload: { transaction },
  });

  assert.strictEqual(tokenRes.statusCode, 401);
});

test("POST /auth/token rejects a challenge signed by the wrong account", async () => {
  const app = await buildApp();
  const client = Keypair.random();
  const impostor = Keypair.random();

  const challengeRes = await app.inject({
    method: "GET",
    url: `/auth/challenge?account=${client.publicKey()}`,
  });
  const { transaction, network_passphrase } = challengeRes.json();

  const tx = new Transaction(transaction, network_passphrase);
  tx.sign(impostor);

  const tokenRes = await app.inject({
    method: "POST",
    url: "/auth/token",
    payload: { transaction: tx.toXDR() },
  });

  assert.strictEqual(tokenRes.statusCode, 401);
});

test("POST /auth/token rejects malformed XDR", async () => {
  const app = await buildApp();

  const tokenRes = await app.inject({
    method: "POST",
    url: "/auth/token",
    payload: { transaction: "not-xdr" },
  });

  assert.strictEqual(tokenRes.statusCode, 401);
});

test("POST /auth/token requires a transaction", async () => {
  const app = await buildApp();

  const tokenRes = await app.inject({
    method: "POST",
    url: "/auth/token",
    payload: {},
  });

  assert.strictEqual(tokenRes.statusCode, 400);
});

test("the challenge is bound to the network the server reports", async () => {
  const app = await buildApp();
  const client = Keypair.random();

  const res = await app.inject({
    method: "GET",
    url: `/auth/challenge?account=${client.publicKey()}`,
  });
  const { network_passphrase } = res.json();

  // Nothing here sets STELLAR_NETWORK, so the server must be on testnet.
  // Signing against the wrong passphrase is a silent auth-bypass risk, so it
  // is asserted rather than assumed.
  assert.strictEqual(network_passphrase, Networks.TESTNET);
});
