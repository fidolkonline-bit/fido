#!/usr/bin/env bash
# Usage: scripts/setup-supabase-cron.sh https://your-app.vercel.app
# Reads DIRECT_URL and CRON_SECRET from .env.local; the secret is never printed.
set -euo pipefail
[ $# -eq 1 ] || { echo "Usage: $0 https://your-app.vercel.app" >&2; exit 1; }
set -a; source .env.local; set +a
[ -n "${CRON_SECRET:-}" ] || { echo "CRON_SECRET is empty in .env.local" >&2; exit 1; }
psql "${DIRECT_URL%%\?*}" -v ON_ERROR_STOP=1 -q -At -v app_url="$1" -v cron_secret="$CRON_SECRET" -f scripts/supabase-cron.sql
