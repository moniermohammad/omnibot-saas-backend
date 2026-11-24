-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CALL', 'MEETING', 'DEMO_PRODUK', 'SURVEY');

-- CreateTable
CREATE TABLE "tenants" (
    "tenant_id" TEXT NOT NULL,
    "business_name" VARCHAR(100) NOT NULL,
    "business_type" VARCHAR(50),
    "address" TEXT,
    "wa_number" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "status" VARCHAR(20) NOT NULL DEFAULT 'FREE_TRIAL',
    "tenant_type" VARCHAR(20) NOT NULL DEFAULT 'PERSONAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscription_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscription_end" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'SALES',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "login_token" VARCHAR(6),
    "token_expiry" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "bot_nodes" (
    "node_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "node_type" VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    "message_text" TEXT NOT NULL,
    "is_form_input" BOOLEAN NOT NULL DEFAULT false,
    "save_to_field" TEXT,
    "next_default_node_id" TEXT,

    CONSTRAINT "bot_nodes_pkey" PRIMARY KEY ("node_id")
);

-- CreateTable
CREATE TABLE "bot_options" (
    "option_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "trigger_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "next_node_id" TEXT NOT NULL,

    CONSTRAINT "bot_options_pkey" PRIMARY KEY ("option_id")
);

-- CreateTable
CREATE TABLE "bot_sessions" (
    "customer_phone_number" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "current_node_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("customer_phone_number")
);

-- CreateTable
CREATE TABLE "leads" (
    "lead_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "form_data" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(30) NOT NULL DEFAULT 'BOT_PROCESS',
    "assigned_to_sales_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "schedule_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "sales_id" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "outcome_status" VARCHAR(20),
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("schedule_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "bot_nodes_tenant_id_idx" ON "bot_nodes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_options_node_id_trigger_key_key" ON "bot_options"("node_id", "trigger_key");

-- CreateIndex
CREATE INDEX "leads_phone_number_idx" ON "leads"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_phone_number_key" ON "leads"("tenant_id", "phone_number");

-- CreateIndex
CREATE INDEX "schedules_tenant_id_idx" ON "schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "schedules_sales_id_idx" ON "schedules"("sales_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_nodes" ADD CONSTRAINT "bot_nodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_options" ADD CONSTRAINT "bot_options_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "bot_nodes"("node_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_sales_id_fkey" FOREIGN KEY ("assigned_to_sales_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("lead_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_sales_id_fkey" FOREIGN KEY ("sales_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
