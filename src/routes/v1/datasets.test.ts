import test from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import { datasetRoutes } from "./datasets.js";
import { disconnectPrisma, isDatabaseAvailable } from "../../lib/prisma.js";

/**
 * These exercise real queries against the seeded database rather than mocking
 * Prisma — the things worth testing here (cursor pagination, filtering, the
 * grouped language counts) are the query semantics, and a mock would only
 * assert that the code calls the functions it calls.
 *
 * CI provides Postgres and runs `db:migrate:deploy` and `db:seed` before the
 * suite, so those steps fail loudly before these ever skip. Locally, without a
 * database, they skip.
 */
const dbUp = await isDatabaseAvailable();
const skip = dbUp ? false : "no DATABASE_URL reachable";

test.after(async () => {
  await disconnectPrisma();
});

async function buildApp() {
  const app = Fastify();
  await app.register(datasetRoutes);
  return app;
}

test("GET /datasets lists seeded datasets", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/datasets" });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.datasets));
  assert.ok(body.datasets.length >= 5, `expected the 5 seeded datasets, got ${body.datasets.length}`);
  assert.ok("next_cursor" in body);
});

test("GET /datasets filters by language_code", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/datasets?language_code=yor" });

  assert.strictEqual(res.statusCode, 200);
  const { datasets } = res.json();
  assert.ok(datasets.length > 0, "seed should contain a yor dataset");
  for (const d of datasets) {
    assert.strictEqual(d.language_code, "yor");
  }
});

test("GET /datasets filters by state", { skip }, async () => {
  const app = await buildApp();

  // The seed includes one archived dataset precisely so this has something to
  // find that the default listing must not surface preferentially.
  const res = await app.inject({ method: "GET", url: "/datasets?state=archived" });

  assert.strictEqual(res.statusCode, 200);
  const { datasets } = res.json();
  assert.ok(datasets.length > 0);
  for (const d of datasets) {
    assert.strictEqual(d.state, "archived");
  }
});

test("GET /datasets paginates with a cursor and does not repeat rows", { skip }, async () => {
  const app = await buildApp();

  const first = await app.inject({ method: "GET", url: "/datasets?limit=2" });
  assert.strictEqual(first.statusCode, 200);
  const page1 = first.json();
  assert.strictEqual(page1.datasets.length, 2);
  assert.ok(page1.next_cursor, "a further page should be advertised");

  const second = await app.inject({
    method: "GET",
    url: `/datasets?limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`,
  });
  assert.strictEqual(second.statusCode, 200);
  const page2 = second.json();

  const ids1 = page1.datasets.map((d: { id: string }) => d.id);
  const ids2 = page2.datasets.map((d: { id: string }) => d.id);
  const overlap = ids1.filter((id: string) => ids2.includes(id));
  assert.deepStrictEqual(overlap, [], "cursor paging must not return a row twice");
});

test("GET /datasets rejects a malformed language_code", { skip }, async () => {
  const app = await buildApp();

  // ISO 639-3 is three characters; a two-letter code is a caller bug worth
  // reporting rather than silently returning everything.
  const res = await app.inject({ method: "GET", url: "/datasets?language_code=en" });

  assert.strictEqual(res.statusCode, 400);
});

test("GET /datasets/:id returns detail with contributors", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/datasets/ds-zul-001" });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.id, "ds-zul-001");
  assert.strictEqual(body.language_code, "zul");
  assert.strictEqual(body.contributors.length, 3);

  // Shares are basis points and should total 10000 across a dataset.
  const total = body.contributors.reduce(
    (sum: number, c: { share_bps: number }) => sum + c.share_bps,
    0,
  );
  assert.strictEqual(total, 10_000);
});

test("GET /datasets/:id 404s for an unknown id", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/datasets/ds-does-not-exist" });

  assert.strictEqual(res.statusCode, 404);
});

test("GET /datasets/:id/licenses returns active licences", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/datasets/ds-yor-001/licenses" });

  assert.strictEqual(res.statusCode, 200);
  const { licenses } = res.json();
  assert.ok(licenses.length > 0);
  for (const l of licenses) {
    assert.strictEqual(l.state, "active");
    // Stroops are serialised as strings so large fees do not lose precision.
    assert.strictEqual(typeof l.fee_paid_stroops, "string");
  }
});

test("GET /datasets/:id/licenses 404s for an unknown dataset", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/datasets/ds-does-not-exist/licenses" });

  assert.strictEqual(res.statusCode, 404);
});

test("GET /datasets/:id/royalties returns payout history newest first", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/datasets/ds-zul-001/royalties" });

  assert.strictEqual(res.statusCode, 200);
  const { royalties } = res.json();
  assert.strictEqual(royalties.length, 2);
  assert.ok(
    new Date(royalties[0].distributed_at) >= new Date(royalties[1].distributed_at),
    "payouts should be ordered newest first",
  );
  assert.strictEqual(typeof royalties[0].total_amount, "string");
});

test("GET /languages counts datasets per language", { skip }, async () => {
  const app = await buildApp();

  const res = await app.inject({ method: "GET", url: "/languages" });

  assert.strictEqual(res.statusCode, 200);
  const { languages } = res.json();
  assert.ok(languages.length >= 5, "the seed spans five languages");

  const yor = languages.find((l: { language_code: string }) => l.language_code === "yor");
  assert.ok(yor, "yor should appear");
  assert.ok(yor.dataset_count >= 1);

  // Codes are returned in ascending order, so a caller can render them
  // without sorting again.
  const codes = languages.map((l: { language_code: string }) => l.language_code);
  assert.deepStrictEqual(codes, [...codes].sort());
});
