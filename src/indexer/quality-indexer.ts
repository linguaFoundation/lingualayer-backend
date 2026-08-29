#!/usr/bin/env node
// Indexes QualityOracle ("oracle", "attested"/"slashed"/"curator") events
// into Postgres (issue #17). Run standalone: `npm run indexer:quality`.
// Deliberately a separate process from the API server (src/index.ts) rather
// than started in-process there - src/index.ts is already touched by #12
// and #15 in this same PR batch, and this indexer has its own lifecycle
// (long-running poll loop) that doesn't belong bolted onto the HTTP server's
// bootstrap.
import { nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { pool, query, runMigrations } from "../db/client.js";

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const QUALITY_ORACLE_CONTRACT_ID = process.env.QUALITY_ORACLE_CONTRACT_ID;
const POLL_INTERVAL_MS = Number(process.env.QUALITY_INDEXER_POLL_MS ?? 5_000);
const INDEXER_NAME = "quality_oracle";

const server = new rpc.Server(SOROBAN_RPC_URL);

function topicFilter(...parts: string[]): string[] {
  return parts.map((p) => nativeToScVal(p, { type: "symbol" }).toXDR("base64"));
}

async function loadCursor(): Promise<number> {
  const { rows } = await query<{ last_ledger: number }>(
    "SELECT last_ledger FROM indexer_cursors WHERE indexer_name = $1",
    [INDEXER_NAME]
  );
  if (rows.length > 0) return rows[0].last_ledger;

  const latest = await server.getLatestLedger();
  // First run: start from the latest ledger rather than the RPC server's
  // full event-retention horizon (usually ~7 days), which would replay a
  // large, mostly-irrelevant backlog on a fresh deployment.
  return latest.sequence;
}

async function saveCursor(ledger: number): Promise<void> {
  await query(
    `INSERT INTO indexer_cursors (indexer_name, last_ledger, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (indexer_name) DO UPDATE SET last_ledger = $2, updated_at = NOW()`,
    [INDEXER_NAME, ledger]
  );
}

async function handleAttested(topics: xdr.ScVal[], value: xdr.ScVal, ledger: number) {
  // Topics: ["oracle", "attested", dataset_id, curator]. Value: { score, rubric_ipfs }.
  const datasetId = scValToNative(topics[2]);
  const curator = scValToNative(topics[3]);
  const payload = scValToNative(value) as { score: number; rubric_ipfs?: string };

  await query(
    `INSERT INTO quality_attestations (dataset_id, curator, score, rubric_ipfs, ledger)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dataset_id, curator) DO UPDATE
       SET score = $3, rubric_ipfs = $4, ledger = $5, created_at = NOW()`,
    [datasetId, curator, payload.score, payload.rubric_ipfs ?? null, ledger]
  );

  await query(
    `INSERT INTO dataset_quality (dataset_id, average_score, attestation_count, updated_at)
     SELECT $1, AVG(score), COUNT(*), NOW() FROM quality_attestations WHERE dataset_id = $1
     ON CONFLICT (dataset_id) DO UPDATE
       SET average_score = EXCLUDED.average_score,
           attestation_count = EXCLUDED.attestation_count,
           updated_at = NOW()`,
    [datasetId]
  );
}

async function handleSlashed(topics: xdr.ScVal[], ledger: number) {
  // Topics: ["oracle", "slashed", curator].
  const curator = scValToNative(topics[2]);
  await query(
    `UPDATE curators SET slashed = TRUE, slashed_ledger = $2, updated_at = NOW() WHERE address = $1`,
    [curator, ledger]
  );
}

async function handleCurator(topics: xdr.ScVal[], ledger: number) {
  // Topics: ["oracle", "curator", curator_address].
  const curator = scValToNative(topics[2]);
  await query(
    `INSERT INTO curators (address, registered_ledger)
     VALUES ($1, $2)
     ON CONFLICT (address) DO NOTHING`,
    [curator, ledger]
  );
}

async function processEvents(fromLedger: number): Promise<number> {
  if (!QUALITY_ORACLE_CONTRACT_ID) {
    throw new Error("QUALITY_ORACLE_CONTRACT_ID is not configured");
  }

  const response = await server.getEvents({
    startLedger: fromLedger,
    filters: [
      {
        type: "contract",
        contractIds: [QUALITY_ORACLE_CONTRACT_ID],
        topics: [topicFilter("oracle", "*")],
      },
    ],
    limit: 100,
  });

  for (const event of response.events) {
    const topics = event.topic;
    const kind = topics.length > 1 ? scValToNative(topics[1]) : undefined;

    if (kind === "attested") {
      await handleAttested(topics, event.value, event.ledger);
    } else if (kind === "slashed") {
      await handleSlashed(topics, event.ledger);
    } else if (kind === "curator") {
      await handleCurator(topics, event.ledger);
    }
  }

  return response.latestLedger;
}

async function main() {
  await runMigrations();
  let cursor = await loadCursor();
  console.log(`[quality-indexer] starting from ledger ${cursor}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const latestLedger = await processEvents(cursor + 1);
      if (latestLedger > cursor) {
        cursor = latestLedger;
        await saveCursor(cursor);
      }
    } catch (err) {
      console.error("[quality-indexer] poll failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
