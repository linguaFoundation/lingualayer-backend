import type { FastifyPluginAsync } from "fastify";
import { commissionRoutes } from "./commissions.js";
import { contributorRoutes } from "./contributors.js";
import { datasetRoutes } from "./datasets.js";
import { qualityRoutes } from "./quality.js";
import { reportRoutes } from "./reports.js";
import { rolesRoutes } from "./roles.js";
import { txRoutes } from "./tx.js";
import { walletConfigRoutes } from "./wallet-config.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  app.get("/meta", async () => ({
    name: "lingualayer-api",
    version: "0.1.0",
    description: "REST facade for Soroban contracts and indexers (scaffold).",
  }));

  // sep010Routes is deliberately absent here: src/index.ts registers it at the
  // root so the SEP-10 endpoints stay at /auth/*, which is where a
  // stellar.toml WEB_AUTH_ENDPOINT points. Registering it in both places made
  // it a duplicate route, and Fastify refuses to start on those.
  await app.register(commissionRoutes);
  await app.register(contributorRoutes);
  await app.register(datasetRoutes);
  await app.register(qualityRoutes);
  await app.register(reportRoutes);
  await app.register(rolesRoutes);
  await app.register(txRoutes);
  await app.register(walletConfigRoutes);

  // TODO: routes for contract invocation prep, webhook ingestion, admin ops
};
