/*
  Warnings:

  - A unique constraint covering the columns `[key_bot_tenant]` on the table `tenants` will be added. If there are existing duplicate values, this will fail.
  - The required column `key_bot_tenant` was added to the `tenants` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "key_bot_tenant" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_key_bot_tenant_key" ON "tenants"("key_bot_tenant");
