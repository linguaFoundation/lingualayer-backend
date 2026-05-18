import type { FastifyPluginAsync } from "fastify";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => ({
    name: "lingualayer-api",
    version: "0.1.0",
    description: "REST facade for Soroban contracts and indexers (scaffold).",
  }));

  // TODO: routes for contract invocation prep, webhook ingestion, admin ops
};
