import { registry } from "../metrics.js";
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const healthRoutes = async (app) => {
    app.get("/health", async () => ({
        status: "ok",
        service: "api",
        timestamp: new Date().toISOString(),
    }));
    app.get("/metrics", async (_req, reply) => {
        reply.header("Content-Type", registry.contentType);
        return registry.metrics();
    });
};
// improvement #15
// improvement #21
// improvement #22
// improvement #25
// improvement #30
