import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }));
};

// improvement #15

// improvement #21

// improvement #22

// improvement #25
