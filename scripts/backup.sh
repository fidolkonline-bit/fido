#!/usr/bin/env bash
# Nightly database backup: pg_dump → encrypt → private Supabase Storage bucket → prune old copies.
# Runs in GitHub Actions (.github/workflows/backup.yml); can also be run by hand with the same variables set.
# Needs: BACKUP_DATABASE_URL (session pooler, port 5432), BACKUP_PASSPHRASE, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
# Nothing secret is printed: the repository and its Action logs are public.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?missing}" "${BACKUP_PASSPHRASE:?missing}" "${SUPABASE_URL:?missing}" "${SUPABASE_SERVICE_ROLE_KEY:?missing}"
BUCKET="fido-backups"
KEEP_DAILY="${KEEP_DAILY:-30}"      # nightly copies kept this many days
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"  # the copy from the 1st of each month kept this many months
API="${SUPABASE_URL%/}/storage/v1"
AUTH=(-H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}")
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
FILE="fido-${STAMP}.dump.enc"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

# pg_dump must be at least as new as the server, so use the client from the postgres image.
PGURL="${BACKUP_DATABASE_URL%%\?*}"
docker run --rm -e PGURL="$PGURL" postgres:17 \
  sh -c 'pg_dump "$PGURL" --schema=public --format=custom --no-owner --no-privileges' > "$WORK/db.dump"

BYTES=$(wc -c < "$WORK/db.dump")
if [ "$BYTES" -lt 20000 ]; then echo "Dump is only ${BYTES} bytes — refusing to upload an empty backup." >&2; exit 1; fi
# A dump that cannot be read back is not a backup.
docker run --rm -v "$WORK:/w:ro" postgres:17 pg_restore --list /w/db.dump > "$WORK/toc.txt"
TABLES=$(grep -c "TABLE DATA" "$WORK/toc.txt" || true)
if [ "$TABLES" -lt 20 ]; then echo "Dump lists only ${TABLES} tables — refusing to upload." >&2; exit 1; fi

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$WORK/db.dump" -out "$WORK/$FILE"

curl -fsS -o /dev/null -X POST "$API/bucket" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":false}" || true   # already exists → fine
curl -fsS -o /dev/null -X POST "$API/object/$BUCKET/$FILE" "${AUTH[@]}" -H "Content-Type: application/octet-stream" -H "x-upsert: true" \
  --data-binary "@$WORK/$FILE"
echo "Uploaded $FILE ($(wc -c < "$WORK/$FILE") bytes, ${TABLES} tables)."

# Prune: keep nightly copies for KEEP_DAILY days and first-of-month copies for KEEP_MONTHLY months.
NOW=$(date -u +%s)
curl -fsS -X POST "$API/object/list/$BUCKET" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d '{"prefix":"","limit":1000,"sortBy":{"column":"name","order":"asc"}}' | jq -r '.[].name' > "$WORK/names.txt"
DELETE=()
while IFS= read -r NAME; do
  case "$NAME" in fido-????-??-??T*.dump.enc) ;; *) continue ;; esac
  DAY="${NAME:5:10}"
  AGE=$(( (NOW - $(date -u -d "$DAY" +%s)) / 86400 ))
  if [ "${DAY:8:2}" = "01" ]; then LIMIT=$(( KEEP_MONTHLY * 31 )); else LIMIT=$KEEP_DAILY; fi
  if [ "$AGE" -gt "$LIMIT" ]; then DELETE+=("$NAME"); fi
done < "$WORK/names.txt"
if [ "${#DELETE[@]}" -gt 0 ]; then
  jq -n --args '{prefixes: $ARGS.positional}' "${DELETE[@]}" | curl -fsS -o /dev/null -X DELETE "$API/object/$BUCKET" "${AUTH[@]}" -H "Content-Type: application/json" -d @-
  echo "Pruned ${#DELETE[@]} old backup(s)."
fi
