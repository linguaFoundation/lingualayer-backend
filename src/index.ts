import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { config } from "./config/env.js";
import { isRedisAvailable, getRedisClient } from "./lib/redisClient.js";
import { rateLimitKeyGenerator } from "./lib/rateLimit.js";
import { healthRoutes } from "./routes/health.js";
import { sep010Routes } from "./routes/sep010.js";
import { v1Routes } from "./routes/v1/index.js";
import { wsRoutes } from "./routes/ws.js";
import { startCommissionIndexer } from "./services/commission-indexer.js";
import { startDatasetRegistryIndexer } from "./services/dataset-registry-indexer.js";
import { recordHttpRequest } from "./metrics.js";

const SHUTDOWN_DRAIN_MS = 15_000;

async function buildServer() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: config.corsOrigin,
  });

  // Global default covers the "public" tier (60 req/min per IP or JWT
  // subject); routes needing a different tier override via
  // `config.rateLimit` (see lib/rateLimit.ts). Backed by Redis when
  // configured and reachable so limits survive a restart — falls back to
  // the plugin's built-in in-memory store otherwise rather than failing
  // to start.
  const redisAvailable = await isRedisAvailable();
  await app.register(rateLimit, {
    max: config.rateLimitPublicMax,
    timeWindow: "1 minute",
    keyGenerator: rateLimitKeyGenerator,
    redis: redisAvailable ? (getRedisClient() ?? undefined) : undefined,
  });
  if (config.redisUrl && !redisAvailable) {
    app.log.warn("REDIS_URL is set but unreachable; rate limiting falling back to in-memory store");
  }
  await app.register(websocket);
  app.addHook("onResponse", async (req, reply) => {
    recordHttpRequest(req.routeOptions?.url ?? req.url, reply.statusCode);
  });

  await app.register(healthRoutes);
  await app.register(sep010Routes);
  await app.register(v1Routes, { prefix: config.apiPrefix });
  await app.register(wsRoutes);

  return app;
}

function registerGracefulShutdown(app: Awaited<ReturnType<typeof buildServer>>) {
  let shuttingDown = false;
  process.on("SIGTERM", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`SIGTERM received, draining for up to ${SHUTDOWN_DRAIN_MS}ms`);

    const forceExit = setTimeout(() => {
      app.log.warn("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_DRAIN_MS);
    forceExit.unref();

    app
      .close()
      .then(() => {
        clearTimeout(forceExit);
        process.exit(0);
      })
      .catch((err) => {
        app.log.error(err);
        clearTimeout(forceExit);
        process.exit(1);
      });
  });
}

buildServer()
  .then(async (app) => {
    if (config.sorobanRpcUrl && config.dataCommissionContractId) {
      startCommissionIndexer({
        rpcUrl: config.sorobanRpcUrl,
        contractId: config.dataCommissionContractId,
        pollIntervalMs: config.commissionIndexerPollIntervalMs,
      });
    } else {
      app.log.warn(
        "SOROBAN_RPC_URL/DATA_COMMISSION_CONTRACT_ID not set — commission indexer disabled",
      );
    }

    if (config.sorobanRpcUrl && config.datasetRegistryContractId) {
      startDatasetRegistryIndexer({
        rpcUrl: config.sorobanRpcUrl,
        contractId: config.datasetRegistryContractId,
      });
    } else {
      app.log.warn(
        "SOROBAN_RPC_URL/DATASET_REGISTRY_CONTRACT_ID not set — dataset registry indexer disabled",
      );
    }

    // Registered before listening so a SIGTERM arriving mid-startup still
    // takes the drain path rather than killing in-flight requests.
    registerGracefulShutdown(app);

    await app.listen({ port: config.port, host: "0.0.0.0" });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
