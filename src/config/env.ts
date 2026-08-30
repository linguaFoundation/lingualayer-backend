import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  JWT_SECRET: z.string().default("dev-insecure-secret-change-in-production"),
  PORT: z.coerce.number().default(8080),
  API_PREFIX: z.string().default("/api/v1"),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_AUTHENTICATED_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_TX_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().positive().default(20),
  REDIS_URL: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // SEP-0010 Web Authentication (GET /auth/challenge, POST /auth/token)
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  SEP10_SERVER_SECRET: z.string().optional(),
  SEP10_HOME_DOMAIN: z.string().default("lingualayer.app"),
  SEP10_WEB_AUTH_DOMAIN: z.string().optional(),
  SEP10_CHALLENGE_TIMEOUT_SECONDS: z.coerce.number().default(300),
  JWT_TTL_SECONDS: z.coerce.number().default(3600),

  // DataCommission event indexer (GET /commissions, GET /commissions/:id)
  SOROBAN_RPC_URL: z.string().default("https://soroban-testnet.stellar.org"),
  DATA_COMMISSION_CONTRACT_ID: z.string().optional(),
  COMMISSION_INDEXER_POLL_INTERVAL_MS: z.coerce.number().default(5000),

  // Commission fulfilment notification emails (POST /commissions/:id/fulfil)
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().default("notifications@lingualayer.app"),
  DATASET_REGISTRY_CONTRACT_ID: z.string().optional(),
  LICENSE_CONTRACT_ID: z.string().optional(),
});

const raw = schema.parse(process.env);

export const config = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  apiPrefix: raw.API_PREFIX,
  rateLimitPublicMax: raw.RATE_LIMIT_PUBLIC_MAX,
  rateLimitAuthenticatedMax: raw.RATE_LIMIT_AUTHENTICATED_MAX,
  rateLimitTxMax: raw.RATE_LIMIT_TX_MAX,
  rateLimitUploadMax: raw.RATE_LIMIT_UPLOAD_MAX,
  redisUrl: raw.REDIS_URL,
  corsOrigin: raw.CORS_ORIGIN,

  stellarNetwork: raw.STELLAR_NETWORK,
  sep10ServerSecret: raw.SEP10_SERVER_SECRET,
  sep10HomeDomain: raw.SEP10_HOME_DOMAIN,
  sep10WebAuthDomain: raw.SEP10_WEB_AUTH_DOMAIN ?? raw.SEP10_HOME_DOMAIN,
  sep10ChallengeTimeoutSeconds: raw.SEP10_CHALLENGE_TIMEOUT_SECONDS,
  jwtSecret: raw.JWT_SECRET,
  jwtTtlSeconds: raw.JWT_TTL_SECONDS,

  sorobanRpcUrl: raw.SOROBAN_RPC_URL,
  dataCommissionContractId: raw.DATA_COMMISSION_CONTRACT_ID,
  commissionIndexerPollIntervalMs: raw.COMMISSION_INDEXER_POLL_INTERVAL_MS,

  sendgridApiKey: raw.SENDGRID_API_KEY,
  sendgridFromEmail: raw.SENDGRID_FROM_EMAIL,
  datasetRegistryContractId: raw.DATASET_REGISTRY_CONTRACT_ID,
  licenseContractId: raw.LICENSE_CONTRACT_ID,
};

// improvement #9

// improvement #14

// improvement #32
