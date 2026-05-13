# LinguaLayer — Backend API (Stellar / Soroban integration)

Royalties, contributor payouts, and dataset marketplace ops need a secure broker—this API is that broker for LinguaLayer on Stellar.

---

## 🎯 What is this service?

This service connects **curators, buyers, and payout rails** to the LinguaLayer Soroban contracts (`dataset-registry`, `license-router`, `royalty-splitter`). On-chain logic splits revenue fairly; this API handles **off-chain reality**: KYCed payout destinations in some jurisdictions, webhook notifications when licenses sell, batched withdrawals, and administrative workflows that should never run solely in a user’s browser tab.

---

## ❓ Problems the **protocol** solves (whole repo)

These come from the [root README](../../README.md) — shared context for why Stellar/Soroban exists here:

- Most African languages are **underrepresented** in AI corpora, slowing equitable voice and text applications.
- Contributors rarely receive **ongoing compensation** when datasets are relicensed or models are commercialized.
- License terms are scattered across PDFs and emails—hard to **enforce** or audit.

---

## 🛠️ Problems **this API** solves specifically

The smart contracts hold **truth on-chain**; they cannot safely hold ERP passwords, IoT vendor keys, bulk files, or cron jobs. That is this service’s job:

- **Payout compliance**: Bank/off-ramp details and tax metadata must not live in public client bundles.
- **Marketplace checkout**: License purchase often involves invoices and settlement partners—integrate via server callbacks.
- **Bulk dataset ops**: Large manifest uploads and virus scanning belong behind authenticated APIs.
- **Webhook fan-out**: Notify language communities when royalties accrue or disputes open.

---

## ✅ Protocol goals this backend helps achieve

- Register datasets with **immutable provenance** and contributor share tables.
- Encode **license SKUs** (region, commercial use, model class) in `license-router`.
- Distribute **royalties** transparently via `royalty-splitter` as revenue arrives.
- Give communities **governance hooks** (curation, appeals, maintenance budgets).

---

## ✨ Capabilities this backend enables (production roadmap)

- **License checkout callbacks**: Confirm payment off-chain → mint/update on-chain license state.
- **Royalty batch runs**: Scheduled jobs to reconcile CSV expectations vs chain balances.
- **Contributor portal APIs**: Session-backed routes for moderators (role-scoped).
- **Indexer hooks**: Ingest events from Stellar/Soroban indexers for dashboards.

---

## 🔗 Soroban crates → API responsibilities

| Crate | What the HTTP layer typically does |
| ----- | ---------------------------------- |
| `dataset-registry` | Coordinate dataset registration pipelines; hash large blobs off-chain; anchor references on-chain. |
| `license-router` | Apply commercial rules after payment confirmation; prepare license-grant/revoke transactions. |
| `royalty-splitter` | Trigger distribution rounds; prove splits match published tables for auditors. |

---

## 🏗️ Architecture & stack

| Layer | Choice |
| ----- | ------ |
| HTTP framework | **Fastify** 5 — low overhead, schema-friendly |
| Language | **TypeScript** (strict, ESM, `verbatimModuleSyntax`) |
| Config | **Zod** parsing in `src/config/env.ts` |
| Blockchain | **Stellar** Horizon + **Soroban** RPC (server-side keys only) |
| Consumers | [`apps/web`](../web/README.md), partner systems, cron workers |

---

## 📁 Package layout

```
apps/backend/
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts              # Fastify bootstrap, CORS, route registration
    ├── config/env.ts         # Typed environment
    └── routes/
        ├── health.ts         # GET /health
        └── v1/index.ts       # Versioned API surface (expand here)
```

---

## 🚀 Quick start

### Prerequisites

- **Node.js** 20.x or **22.x** (LTS)
- npm (or pnpm/yarn per org standard)

### Install & run

```bash
cd apps/backend
npm install
cp .env.example .env
# Edit .env — see tables below
npm run dev
```

Default: **http://localhost:8080** · Health: **GET** `/health` · Meta: **GET** `/api/v1/meta`

### Run with the Next.js frontend

```bash
# Terminal A — API
cd apps/backend && npm run dev

# Terminal B — Web
cd apps/web && npm install && npm run dev
```

Set `CORS_ORIGIN` in `.env` to match the web origin (e.g. `http://localhost:3000`).

---

## 📜 Scripts

| Command | Purpose |
| ------- | ------- |
| `npm install` | Install dependencies |
| `npm run dev` | `tsx watch` — reload on change |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled server |
| `npm run lint` | `tsc --noEmit` typecheck |

---

## 🔐 Environment variables

### Baseline (implemented)

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `NODE_ENV` | `development` | Environment name |
| `PORT` | `8080` | Listen port |
| `API_PREFIX` | `/api/v1` | Prefix for versioned routes |
| `CORS_ORIGIN` | `http://localhost:3000` | Browser origin allowed by CORS |

### Production / integration (plan — **do not commit secrets**)

| Variable | Example | Purpose |
| -------- | ------- | ------- |
| `SOROBAN_RPC_URL` | `https://…` | Contract invocation path. |
| `PAYOUT_WEBHOOK_SECRET` | (secret) | Verify callbacks from payment processors. |
| `MODERATOR_JWT_SECRET` | (secret) | Session tokens for curator APIs (replace with OIDC in prod). |

---

## 🔌 HTTP surface

### Implemented (scaffold)

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Liveness for load balancers & CI |
| GET | `/api/v1/meta` | Service name / version |

### Planned themes (domain routes — implement under `src/routes/v1/`)

- `POST /api/v1/licenses/purchase-intent` — start checkout; returns chain steps for buyer wallet if applicable.
- `POST /api/v1/payouts/run` — operator-only batch payout reconciliation.
- `GET /api/v1/datasets/:id/manifest` — signed URL or streaming for large artifacts.

---

## 🧪 Testing & quality

```bash
npm run lint
```

CI should mirror this (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

Add **contract integration tests** in the Rust workspace and **API integration tests** (e.g. `vitest` + `supertest`) as routes grow.

---

## 🚢 Deployment notes

- Run behind TLS termination (load balancer or reverse proxy).
- Store signing keys in **KMS/HSM**, never in repo.
- Restrict Soroban RPC by IP allowlist or private gateway when possible.
- Emit structured logs (JSON) with **request IDs** for regulator audits (especially MediProof / CivicLedger / ReliefFlow).

---

## 🤝 Contributing

See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md). Contract changes must stay aligned with this API’s eventual routes and [`../../docs/SITE_MAP.md`](../../docs/SITE_MAP.md).

---

## 📄 License

Match the repository license (Apache-2.0 suggested for OSS grants — confirm per org).

---

## 📞 Support & related docs

| Doc | Link |
| --- | ---- |
| Monorepo overview | [`../../README.md`](../../README.md) |
| Frontend | [`../web/README.md`](../web/README.md) |
| Architecture notes | [`../../docs/layout-plan.md`](../../docs/layout-plan.md) |
| Milestones → issues | [`../../docs/milestones-issues.md`](../../docs/milestones-issues.md) |

---

**Package:** `lingualayer-api` · **Slug:** `lingualayer`
