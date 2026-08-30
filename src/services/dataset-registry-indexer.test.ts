import test from "node:test";
import assert from "node:assert";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { rpc } from "@stellar/stellar-sdk";
import {
  applyEvent,
  decodeEvent,
  readCheckpoint,
  writeCheckpoint,
} from "./dataset-registry-indexer.js";
import { disconnectPrisma, getPrisma, isDatabaseAvailable } from "../lib/prisma.js";

const dbUp = await isDatabaseAvailable();
const skip = dbUp ? false : "no DATABASE_URL reachable";

test.after(async () => {
  await disconnectPrisma();
});

/** Builds an event in the shape the RPC returns one. */
function makeEvent(topics: string[], data: Record<string, unknown>, ledger: number) {
  return {
    ledger,
    topic: topics.map((t) => nativeToScVal(t, { type: "symbol" })),
    value: nativeToScVal(data),
  } as unknown as rpc.Api.EventResponse;
}

// -- decoding ---------------------------------------------------------------

test("decodes a dataset_registered event", () => {
  const decoded = decodeEvent(
    makeEvent(
      ["dataset_registered"],
      {
        id: "ds-test-001",
        owner: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        language_code: "yor",
        name: "Test corpus",
        metadata_ipfs: "bafytest",
      },
      1000,
    ),
  );

  assert.ok(decoded);
  assert.strictEqual(decoded.kind, "dataset_registered");
  if (decoded.kind !== "dataset_registered") return;
  assert.strictEqual(decoded.id, "ds-test-001");
  assert.strictEqual(decoded.languageCode, "yor");
  assert.strictEqual(decoded.ledger, 1000);
});

test("truncates a language code longer than ISO 639-3", () => {
  // The column is CHAR(3); a longer code would be a write error at insert
  // time rather than a decode failure, which is much harder to trace back.
  const decoded = decodeEvent(
    makeEvent(
      ["dataset_registered"],
      { id: "ds-x", owner: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", language_code: "yoruba" },
      1,
    ),
  );

  assert.ok(decoded);
  if (decoded.kind !== "dataset_registered") return assert.fail("wrong kind");
  assert.strictEqual(decoded.languageCode, "yor");
});

test("decodes a licence fee that exceeds Number.MAX_SAFE_INTEGER", () => {
  const huge = "92233720368547758";
  const decoded = decodeEvent(
    makeEvent(
      ["license_issued"],
      { id: "lic-1", dataset_id: "ds-1", licensee: "GB", license_type: "commercial", fee_stroops: huge },
      5,
    ),
  );

  assert.ok(decoded);
  if (decoded.kind !== "license_issued") return assert.fail("wrong kind");
  // Precision must survive; this is money.
  assert.strictEqual(decoded.feePaidStroops, BigInt(huge));
});

test("ignores an unrecognised event type instead of throwing", () => {
  // A contract upgrade that emits something new must not stop the indexer.
  assert.strictEqual(decodeEvent(makeEvent(["something_new"], { id: "x" }, 1)), undefined);
});

test("ignores an event missing required fields", () => {
  assert.strictEqual(
    decodeEvent(makeEvent(["dataset_registered"], { id: "ds-1" }, 1)),
    undefined,
    "a registration with no owner or language is not indexable",
  );
});

test("decodes a royalty_distributed event", () => {
  const decoded = decodeEvent(
    makeEvent(["royalty_distributed"], { dataset_id: "ds-1", total_amount: "5000000000" }, 77),
  );

  assert.ok(decoded);
  if (decoded.kind !== "royalty_distributed") return assert.fail("wrong kind");
  assert.strictEqual(decoded.totalAmount, 5_000_000_000n);
  assert.strictEqual(decoded.ledger, 77);
});

// -- persistence ------------------------------------------------------------

const TEST_ID = "ds-indexer-test-001";

async function cleanup() {
  const prisma = getPrisma();
  await prisma.royaltyPayout.deleteMany({ where: { datasetId: TEST_ID } });
  await prisma.license.deleteMany({ where: { datasetId: TEST_ID } });
  await prisma.dataset.deleteMany({ where: { id: TEST_ID } });
}

test("applying the same registration twice leaves one row", { skip }, async () => {
  await cleanup();
  const prisma = getPrisma();

  const event = decodeEvent(
    makeEvent(
      ["dataset_registered"],
      {
        id: TEST_ID,
        owner: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        language_code: "swa",
        name: "Idempotency corpus",
      },
      4242,
    ),
  );
  assert.ok(event);

  await applyEvent(event);
  await applyEvent(event);

  const rows = await prisma.dataset.findMany({ where: { id: TEST_ID } });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]!.createdLedger, 4242);

  await cleanup();
});

test("a replay does not move createdLedger", { skip }, async () => {
  await cleanup();
  const prisma = getPrisma();

  const base = {
    id: TEST_ID,
    owner: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    language_code: "swa",
    name: "Corpus",
  };

  await applyEvent(decodeEvent(makeEvent(["dataset_registered"], base, 100))!);
  // Same dataset re-delivered at a later ledger, as happens after a restart.
  await applyEvent(decodeEvent(makeEvent(["dataset_registered"], base, 900))!);

  const row = await prisma.dataset.findUnique({ where: { id: TEST_ID } });
  assert.strictEqual(row?.createdLedger, 100, "creation ledger is historical fact");

  await cleanup();
});

test("a royalty payout is not duplicated by a replay", { skip }, async () => {
  await cleanup();
  const prisma = getPrisma();

  await applyEvent(
    decodeEvent(
      makeEvent(
        ["dataset_registered"],
        { id: TEST_ID, owner: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", language_code: "swa", name: "C" },
        10,
      ),
    )!,
  );

  const payout = decodeEvent(
    makeEvent(["royalty_distributed"], { dataset_id: TEST_ID, total_amount: "123" }, 55),
  )!;
  await applyEvent(payout);
  await applyEvent(payout);

  const payouts = await prisma.royaltyPayout.findMany({ where: { datasetId: TEST_ID } });
  assert.strictEqual(payouts.length, 1, "(dataset, ledger) is the natural key");

  await cleanup();
});

test("a state change for an unknown dataset is a no-op", { skip }, async () => {
  await cleanup();

  // Events can arrive out of order, or the registration may predate the
  // retention window. Neither should crash the indexer.
  await applyEvent(
    decodeEvent(makeEvent(["dataset_state_changed"], { id: "ds-never-seen", state: "archived" }, 7))!,
  );

  const row = await getPrisma().dataset.findUnique({ where: { id: "ds-never-seen" } });
  assert.strictEqual(row, null);
});

test("the checkpoint round-trips", { skip }, async () => {
  await writeCheckpoint(123_456);
  assert.strictEqual(await readCheckpoint(), 123_456);

  await writeCheckpoint(123_457);
  assert.strictEqual(await readCheckpoint(), 123_457, "a later checkpoint replaces the earlier one");
});
