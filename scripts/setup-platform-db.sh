#!/usr/bin/env bash
# Create the shared multi-tenant Neon database for the Successifier platform
# (EU region) and apply all Prisma migrations.
#
# Requires a Neon API key (console.neon.tech → Profile → Account settings →
# API keys):
#
#   NEON_API_KEY=neon_api_key_... bash scripts/setup-platform-db.sh
#
# Idempotent-ish: refuses to create a second project with the same name.
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-successifier-platform}"
# Frankfurt. Other EU options: aws-eu-west-2 (London), azure-gwc (Germany).
REGION_ID="${REGION_ID:-aws-eu-central-1}"
# The Neon org used by the existing products (from .neon).
ORG_ID="${ORG_ID:-org-bold-king-64422222}"

if [ -z "${NEON_API_KEY:-}" ]; then
  echo "ERROR: Set NEON_API_KEY (create one at console.neon.tech → Account settings → API keys)." >&2
  exit 1
fi

NEONCTL="npx --yes neonctl@latest"

echo "==> Checking for an existing project named '$PROJECT_NAME'…"
EXISTING_ID=$($NEONCTL projects list --org-id "$ORG_ID" --output json 2>/dev/null \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const list=j.projects||j;const hit=(list||[]).find(p=>p.name===process.argv[1]);console.log(hit?hit.id:'');})" "$PROJECT_NAME")

if [ -n "$EXISTING_ID" ]; then
  echo "==> Project already exists: $EXISTING_ID — reusing it."
  PROJECT_ID="$EXISTING_ID"
else
  echo "==> Creating Neon project '$PROJECT_NAME' in $REGION_ID…"
  CREATE_JSON=$($NEONCTL projects create \
    --name "$PROJECT_NAME" \
    --region-id "$REGION_ID" \
    --org-id "$ORG_ID" \
    --output json)
  PROJECT_ID=$(echo "$CREATE_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.project?.id||j.id||'');})")
  if [ -z "$PROJECT_ID" ]; then
    echo "ERROR: Could not parse project id from neonctl output:" >&2
    echo "$CREATE_JSON" >&2
    exit 1
  fi
  echo "==> Created project: $PROJECT_ID"
fi

echo "==> Fetching connection strings…"
DATABASE_URL=$($NEONCTL connection-string --project-id "$PROJECT_ID" --pooled --output json 2>/dev/null \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).connection_string||'')}catch{console.log(d.trim())}})")
[ -n "$DATABASE_URL" ] || DATABASE_URL=$($NEONCTL connection-string --project-id "$PROJECT_ID" --pooled)
DATABASE_URL_UNPOOLED=$($NEONCTL connection-string --project-id "$PROJECT_ID")

echo "==> Applying Prisma migrations…"
DATABASE_URL="$DATABASE_URL_UNPOOLED" npx prisma migrate deploy

cat <<EOF

============================================================
 Successifier platform database is ready (region: $REGION_ID)
============================================================
 Project:  $PROJECT_NAME ($PROJECT_ID)

 Set these in the deployment (Vercel → Environment Variables):

 DATABASE_URL="$DATABASE_URL"
 DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED"

 Next steps:
   1. Create the first tenant:
      DATABASE_URL="\$DATABASE_URL_UNPOOLED" node scripts/create-tenant.js demo "Demo AB" --admin you@example.com
   2. Deploy (see VERCEL_SETUP.md) with TENANT_ROOT_DOMAIN set.
============================================================
EOF
