import type { FastifyPluginAsync } from "fastify";

export const commissionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/commissions", async (req) => {
    const { state = "open", page = "1", limit = "20" } = req.query as Record<string, string>;
    // TODO: query Prisma for commissions with state filter
    return {
      items: [],
      total: 0,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  });

  app.get("/commissions/:id", async (req) => {
    const { id } = req.params as { id: string };
    // TODO: fetch commission by ID from DB + on-chain data
    return { id, state: "open" };
  });

  app.post("/commissions/prepare", async (req) => {
    // Prepare unsigned XDR for DataCommission.post_commission()
    // Returns XDR for wallet to sign
    return { xdr: "" };
  });
};
