import type { FastifyPluginAsync } from "fastify";
import { registry, renderMetrics } from "../metrics.js";

// Readiness state: false until the process has finished whatever startup
// work makes it safe to receive traffic (e.g. the indexer has caught up).
// Exported setter so subsystems can flip it without health.ts needing to
// know about them - mirrors the pattern in src/metrics.ts.
let ready = true;
export function setReady(value: boolean) {
  ready = value;
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // src/metrics.ts carries two registries: the prom-client one holding the
  // indexer counters, and a hand-rolled text exposition fed by the onResponse
  // hook in src/index.ts. Both are scraped from this single route — the two
  // copies of /metrics that existed before were a duplicate route, which
  // Fastify refuses to start on.
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", registry.contentType);
    return `${renderMetrics()}\n${await registry.metrics()}`;
  });

  app.get("/health", async (_req, reply) => {
    const body = {
      status: ready ? "ok" : "degraded",
      service: "api",
      timestamp: new Date().toISOString(),
    };
    // TODO: gate on real DB/Redis connectivity once those clients exist.
    if (!ready) reply.status(503);
    return body;
  });

  // Kubernetes liveness probe: always 200 while the process is up. Never
  // gated on downstream dependencies - that's what readiness is for; a
  // liveness probe failing on a downstream outage would restart a perfectly
  // healthy process.
  app.get("/health/liveness", async () => ({ status: "ok" }));

  // Kubernetes readiness probe: only 200 once startup work (e.g. indexer
  // catch-up) has completed.
  app.get("/health/readiness", async (_req, reply) => {
    if (!ready) {
      reply.status(503);
      return { status: "not_ready" };
    }
    return { status: "ready" };
  });
};
