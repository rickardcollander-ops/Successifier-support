-- Per-tenant runtime configuration (branding, language, agents, integrations…)
ALTER TABLE "Tenant" ADD COLUMN "settings" JSONB;
