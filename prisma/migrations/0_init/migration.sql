-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "datasets" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "language_code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "metadata_ipfs" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'active',
    "created_ledger" INTEGER NOT NULL,
    "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributors" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "share_bps" INTEGER NOT NULL,

    CONSTRAINT "contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "licensee" TEXT NOT NULL,
    "license_type" TEXT NOT NULL,
    "fee_paid_stroops" BIGINT NOT NULL,
    "expiry_ledger" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'active',
    "region_code" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "royalty_payouts" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "distributed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "royalty_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "tx_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_attestations" (
    "id" SERIAL NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "curator" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rubric_ipfs" TEXT,
    "ledger" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curators" (
    "address" TEXT NOT NULL,
    "registered_ledger" INTEGER NOT NULL,
    "slashed" BOOLEAN NOT NULL DEFAULT false,
    "slashed_ledger" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curators_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "dataset_quality" (
    "dataset_id" TEXT NOT NULL,
    "average_score" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "attestation_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_quality_pkey" PRIMARY KEY ("dataset_id")
);

-- CreateTable
CREATE TABLE "indexer_cursors" (
    "indexer_name" TEXT NOT NULL,
    "last_ledger" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_cursors_pkey" PRIMARY KEY ("indexer_name")
);

-- CreateIndex
CREATE INDEX "datasets_language_code_idx" ON "datasets"("language_code");

-- CreateIndex
CREATE INDEX "datasets_state_idx" ON "datasets"("state");

-- CreateIndex
CREATE INDEX "datasets_owner_id_idx" ON "datasets"("owner_id");

-- CreateIndex
CREATE INDEX "datasets_language_code_state_idx" ON "datasets"("language_code", "state");

-- CreateIndex
CREATE INDEX "contributors_address_idx" ON "contributors"("address");

-- CreateIndex
CREATE UNIQUE INDEX "contributors_dataset_id_address_key" ON "contributors"("dataset_id", "address");

-- CreateIndex
CREATE INDEX "licenses_dataset_id_idx" ON "licenses"("dataset_id");

-- CreateIndex
CREATE INDEX "licenses_licensee_idx" ON "licenses"("licensee");

-- CreateIndex
CREATE INDEX "licenses_dataset_id_state_idx" ON "licenses"("dataset_id", "state");

-- CreateIndex
CREATE INDEX "royalty_payouts_dataset_id_idx" ON "royalty_payouts"("dataset_id");

-- CreateIndex
CREATE INDEX "royalty_payouts_dataset_id_distributed_at_idx" ON "royalty_payouts"("dataset_id", "distributed_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_created_at_idx" ON "audit_logs"("entity", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs"("actor");

-- CreateIndex
CREATE UNIQUE INDEX "quality_attestations_dataset_id_curator_key" ON "quality_attestations"("dataset_id", "curator");

-- AddForeignKey
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "royalty_payouts" ADD CONSTRAINT "royalty_payouts_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

