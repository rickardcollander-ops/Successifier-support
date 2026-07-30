-- Platform billing per tenant (plan, status, trial, Stripe references)
ALTER TABLE "Tenant" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE "Tenant" ADD COLUMN "billingStatus" TEXT NOT NULL DEFAULT 'trialing';
ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "stripeSubscriptionId" TEXT;
CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");

-- Existing tenants (the launch customers) predate billing — mark them as
-- active custom-plan tenants so nothing gets blocked by the rollout.
UPDATE "Tenant" SET "plan" = 'custom', "billingStatus" = 'active';
