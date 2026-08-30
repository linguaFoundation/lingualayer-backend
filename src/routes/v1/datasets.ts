import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPrisma } from "../../lib/prisma.js";
import { getRedisClient } from "../../lib/redisClient.js";

/**
 * Dataset read endpoints.
 *
 * Pagination is cursor-based rather than offset-based. The indexer inserts
 * continuously, so an offset page walks over rows that shifted underneath it —
 * a reader paging through the list would see duplicates and skip records. A
 * cursor is stable against concurrent inserts.
 */

const CACHE_TTL_SECONDS = 30;

const listQuerySchema = z.object({
  language_code: z.string().length(3).optional(),
  state: z.string().min(1).max(32).optional(),
  /// Opaque to callers: the id of the last row of the previous page.
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Shapes a Dataset row for the wire. BigInt is not JSON-serialisable. */
function serialiseDataset(d: {
  id: string;
  ownerId: string;
  languageCode: string;
  name: string;
  metadataIpfs: string | null;
  version: number;
  state: string;
  createdLedger: number;
  indexedAt: Date;
}) {
  return {
    id: d.id,
    owner_id: d.ownerId,
    language_code: d.languageCode,
    name: d.name,
    metadata_ipfs: d.metadataIpfs,
    version: d.version,
    state: d.state,
    created_ledger: d.createdLedger,
    indexed_at: d.indexedAt.toISOString(),
  };
}

function serialiseLicense(l: {
  id: string;
  datasetId: string;
  licensee: string;
  licenseType: string;
  feePaidStroops: bigint;
  expiryLedger: number | null;
  state: string;
  regionCode: string | null;
  issuedAt: Date;
}) {
  return {
    id: l.id,
    dataset_id: l.datasetId,
    licensee: l.licensee,
    license_type: l.licenseType,
    // A string, not a number: stroop amounts exceed the range JSON numbers
    // round-trip safely, and silently losing precision on a fee is worse than
    // making the caller parse it.
    fee_paid_stroops: l.feePaidStroops.toString(),
    expiry_ledger: l.expiryLedger,
    state: l.state,
    region_code: l.regionCode,
    issued_at: l.issuedAt.toISOString(),
  };
}

/**
 * Cache read-through. Falls back to calling `produce` directly whenever Redis
 * is absent or misbehaving — a cache outage should slow the API down, not
 * take it down.
 */
async function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  const redis = getRedisClient();
  if (!redis) return produce();

  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return produce();
  }

  const value = await produce();
  try {
    await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
  } catch {
    // Losing the write is fine; the next request recomputes.
  }
  return value;
}

export const datasetRoutes: FastifyPluginAsync = async (app) => {
  const prisma = getPrisma();

  app.get("/datasets", async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { language_code, state, cursor, limit } = parsed.data;

    const where = {
      ...(language_code ? { languageCode: language_code } : {}),
      ...(state ? { state } : {}),
    };

    const key = `datasets:list:${language_code ?? "*"}:${state ?? "*"}:${cursor ?? "start"}:${limit}`;

    return cached(key, async () => {
      // One extra row tells us whether a further page exists without a second
      // count query.
      const rows = await prisma.dataset.findMany({
        where,
        orderBy: { id: "asc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return {
        datasets: page.map(serialiseDataset),
        next_cursor: hasMore ? page[page.length - 1]!.id : null,
      };
    });
  });

  app.get("/datasets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };

    const body = await cached(`datasets:detail:${id}`, async () => {
      const dataset = await prisma.dataset.findUnique({
        where: { id },
        include: { contributors: { orderBy: { shareBps: "desc" } } },
      });
      if (!dataset) return null;

      return {
        ...serialiseDataset(dataset),
        contributors: dataset.contributors.map((c) => ({
          address: c.address,
          share_bps: c.shareBps,
        })),
      };
    });

    if (!body) return reply.status(404).send({ error: "Dataset not found" });
    return body;
  });

  app.get("/datasets/:id/licenses", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { state = "active" } = req.query as { state?: string };

    const exists = await prisma.dataset.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.status(404).send({ error: "Dataset not found" });

    return cached(`datasets:licenses:${id}:${state}`, async () => {
      const licenses = await prisma.license.findMany({
        where: { datasetId: id, state },
        orderBy: { issuedAt: "desc" },
      });
      return { licenses: licenses.map(serialiseLicense) };
    });
  });

  app.get("/datasets/:id/royalties", async (req, reply) => {
    const { id } = req.params as { id: string };

    const exists = await prisma.dataset.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.status(404).send({ error: "Dataset not found" });

    return cached(`datasets:royalties:${id}`, async () => {
      const payouts = await prisma.royaltyPayout.findMany({
        where: { datasetId: id },
        orderBy: { distributedAt: "desc" },
      });
      return {
        royalties: payouts.map((p) => ({
          id: p.id,
          dataset_id: p.datasetId,
          total_amount: p.totalAmount.toString(),
          ledger: p.ledger,
          distributed_at: p.distributedAt.toISOString(),
        })),
      };
    });
  });

  app.get("/languages", async () => {
    return cached("languages:list", async () => {
      const grouped = await prisma.dataset.groupBy({
        by: ["languageCode"],
        _count: { _all: true },
        orderBy: { languageCode: "asc" },
      });
      return {
        languages: grouped.map((g) => ({
          language_code: g.languageCode,
          dataset_count: g._count._all,
        })),
      };
    });
  });
};
