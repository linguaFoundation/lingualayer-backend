import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { getPrisma } from "../lib/prisma.js";
import { getRedisClient } from "../lib/redisClient.js";
import { setIndexerLagLedgers } from "../metrics.js";

/**
 * DatasetRegistry event indexer.
 *
 * The issue describes streaming from Horizon's SSE endpoint. Horizon does not
 * serve Soroban contract events — they come from the Soroban RPC's getEvents,
 * which is what the existing commission indexer polls and what this uses.
 *
 * Every write is an upsert keyed on the contract-assigned id, so replaying a
 * ledger range is harmless. That matters because the RPC's event retention
 * window means a restart after a long outage may re-deliver events that were
 * already processed.
 */

const INDEXER_NAME = "dataset-registry";
const CHECKPOINT_KEY = `indexer:checkpoint:${INDEXER_NAME}`;

export interface DatasetRegistryIndexerOptions {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs?: number;
  /** Ledger to start from when no checkpoint exists. */
  startLedger?: number;
}

/** A decoded DatasetRegistry event, before it reaches the database. */
export type DecodedEvent =
  | { kind: "dataset_registered"; id: string; owner: string; languageCode: string; name: string; metadataIpfs: string | null; version: number; ledger: number }
  | { kind: "dataset_state_changed"; id: string; state: string; ledger: number }
  | { kind: "license_issued"; id: string; datasetId: string; licensee: string; licenseType: string; feePaidStroops: bigint; expiryLedger: number | null; regionCode: string | null; ledger: number }
  | { kind: "royalty_distributed"; datasetId: string; totalAmount: bigint; ledger: number };

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return 0n;
}

/**
 * Decodes one RPC event into something the database layer understands.
 *
 * Returns undefined for anything unrecognised rather than throwing: a
 * contract upgrade that adds an event type should not stop the indexer, it
 * should be ignored until this file learns about it.
 */
export function decodeEvent(event: rpc.Api.EventResponse): DecodedEvent | undefined {
  let topics: unknown[];
  let data: Record<string, unknown>;
  try {
    topics = event.topic.map((t) => scValToNative(t));
    data = (scValToNative(event.value) ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const kind = asString(topics[0]);
  const ledger = event.ledger;

  switch (kind) {
    case "dataset_registered": {
      const id = asString(data.id) ?? asString(topics[1]);
      const owner = asString(data.owner);
      const languageCode = asString(data.language_code);
      if (!id || !owner || !languageCode) return undefined;
      return {
        kind: "dataset_registered",
        id,
        owner,
        languageCode: languageCode.slice(0, 3),
        name: asString(data.name) ?? id,
        metadataIpfs: asString(data.metadata_ipfs),
        version: typeof data.version === "number" ? data.version : 1,
        ledger,
      };
    }
    case "dataset_state_changed": {
      const id = asString(data.id) ?? asString(topics[1]);
      const state = asString(data.state);
      if (!id || !state) return undefined;
      return { kind: "dataset_state_changed", id, state, ledger };
    }
    case "license_issued": {
      const id = asString(data.id) ?? asString(topics[1]);
      const datasetId = asString(data.dataset_id);
      const licensee = asString(data.licensee);
      if (!id || !datasetId || !licensee) return undefined;
      return {
        kind: "license_issued",
        id,
        datasetId,
        licensee,
        licenseType: asString(data.license_type) ?? "unknown",
        feePaidStroops: asBigInt(data.fee_stroops ?? data.fee_paid_stroops),
        expiryLedger: typeof data.expiry_ledger === "number" ? data.expiry_ledger : null,
        regionCode: asString(data.region_code),
        ledger,
      };
    }
    case "royalty_distributed": {
      const datasetId = asString(data.dataset_id) ?? asString(topics[1]);
      if (!datasetId) return undefined;
      return {
        kind: "royalty_distributed",
        datasetId,
        totalAmount: asBigInt(data.total_amount),
        ledger,
      };
    }
    default:
      return undefined;
  }
}

/**
 * Applies a decoded event. Idempotent — running the same event twice leaves
 * the same rows.
 */
export async function applyEvent(event: DecodedEvent): Promise<void> {
  const prisma = getPrisma();

  switch (event.kind) {
    case "dataset_registered":
      await prisma.dataset.upsert({
        where: { id: event.id },
        create: {
          id: event.id,
          ownerId: event.owner,
          languageCode: event.languageCode,
          name: event.name,
          metadataIpfs: event.metadataIpfs,
          version: event.version,
          createdLedger: event.ledger,
        },
        // createdLedger is not updated: it records when the dataset first
        // appeared on-chain, which a replay must not move.
        update: {
          ownerId: event.owner,
          languageCode: event.languageCode,
          name: event.name,
          metadataIpfs: event.metadataIpfs,
          version: event.version,
          indexedAt: new Date(),
        },
      });
      return;

    case "dataset_state_changed":
      // updateMany rather than update: a state change for a dataset this
      // indexer never saw registered should be a no-op, not a crash.
      await prisma.dataset.updateMany({
        where: { id: event.id },
        data: { state: event.state, indexedAt: new Date() },
      });
      return;

    case "license_issued":
      await prisma.license.upsert({
        where: { id: event.id },
        create: {
          id: event.id,
          datasetId: event.datasetId,
          licensee: event.licensee,
          licenseType: event.licenseType,
          feePaidStroops: event.feePaidStroops,
          expiryLedger: event.expiryLedger,
          regionCode: event.regionCode,
        },
        update: {
          licensee: event.licensee,
          licenseType: event.licenseType,
          feePaidStroops: event.feePaidStroops,
          expiryLedger: event.expiryLedger,
          regionCode: event.regionCode,
        },
      });
      return;

    case "royalty_distributed": {
      // Payouts have no contract-assigned id, so the natural key is
      // (dataset, ledger) — one distribution per dataset per ledger. Checked
      // before insert so a replay does not duplicate the row.
      const existing = await prisma.royaltyPayout.findFirst({
        where: { datasetId: event.datasetId, ledger: event.ledger },
        select: { id: true },
      });
      if (existing) return;

      await prisma.royaltyPayout.create({
        data: {
          datasetId: event.datasetId,
          totalAmount: event.totalAmount,
          ledger: event.ledger,
        },
      });
      return;
    }
  }
}

/**
 * Reads the checkpoint.
 *
 * Redis first, as the issue specifies. The indexer_cursors table is the
 * fallback and the durable copy: Redis is configured as a cache in this
 * service and may be evicted or absent, and losing the checkpoint means
 * re-scanning from the retention horizon on every restart.
 */
export async function readCheckpoint(): Promise<number | undefined> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const value = await redis.get(CHECKPOINT_KEY);
      if (value && /^\d+$/.test(value)) return Number(value);
    } catch {
      // fall through to Postgres
    }
  }

  try {
    const row = await getPrisma().indexerCursor.findUnique({
      where: { indexerName: INDEXER_NAME },
    });
    return row?.lastLedger;
  } catch {
    return undefined;
  }
}

export async function writeCheckpoint(ledger: number): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(CHECKPOINT_KEY, String(ledger));
    } catch {
      // Postgres below is the durable copy; a Redis failure is not fatal.
    }
  }

  try {
    await getPrisma().indexerCursor.upsert({
      where: { indexerName: INDEXER_NAME },
      create: { indexerName: INDEXER_NAME, lastLedger: ledger },
      update: { lastLedger: ledger, updatedAt: new Date() },
    });
  } catch {
    // Leaving the checkpoint behind costs a replay, which the upserts above
    // are built to tolerate.
  }
}

export function startDatasetRegistryIndexer(
  options: DatasetRegistryIndexerOptions,
): { stop: () => void } {
  const server = new rpc.Server(options.rpcUrl);
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const filters = [{ type: "contract" as const, contractIds: [options.contractId] }];

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  async function tick() {
    if (stopped) return;

    try {
      const checkpoint = await readCheckpoint();

      // getEvents requires either a startLedger or a cursor. With neither a
      // checkpoint nor a configured start, begin at the current tip rather
      // than the retention horizon: a first run should catch up from now, not
      // replay everything the RPC still holds.
      const startLedger =
        checkpoint !== undefined
          ? checkpoint + 1
          : (options.startLedger ?? (await server.getLatestLedger()).sequence);

      const page = await server.getEvents({ startLedger, filters, limit: 100 });

      let highest = checkpoint ?? 0;
      for (const event of page.events ?? []) {
        const decoded = decodeEvent(event);
        if (decoded) await applyEvent(decoded);
        if (event.ledger > highest) highest = event.ledger;
      }

      if (highest > (checkpoint ?? 0)) await writeCheckpoint(highest);

      // Lag is how far behind the chain tip this indexer is, which is the
      // number an alert should fire on — not the raw processed count.
      if (typeof page.latestLedger === "number") {
        setIndexerLagLedgers(Math.max(0, page.latestLedger - highest));
      }
    } catch (err) {
      console.error("[dataset-registry-indexer] poll failed", err);
    } finally {
      if (!stopped) timer = setTimeout(tick, pollIntervalMs);
    }
  }

  void tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
