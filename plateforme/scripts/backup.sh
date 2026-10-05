#!/usr/bin/env bash
#
# A complete backup: the database AND the uploaded files, in one archive.
#
# ⚠ THE DATABASE ALONE IS NOT A BACKUP.
#
# Since attachments landed (ADR-0016) the files live on disk, outside Postgres.
# A `pg_dump` on its own restores a school whose every homework attachment is a
# broken link, and nothing in the restore would say so. That is the failure this
# script exists to prevent, and `verify-backup.sh` is what proves it worked.
#
# Usage:  scripts/backup.sh [destination-directory]
#
set -euo pipefail

DEST="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

: "${DATABASE_ADMIN_URL:?Set DATABASE_ADMIN_URL to the database to back up}"
UPLOADS="${UPLOAD_DIR:-./.uploads}"

mkdir -p "$DEST"

echo "==> Dumping the database"
# Custom format: compressed, and restorable table by table if a restore ever has
# to be partial.
pg_dump --format=custom --no-owner --file="$WORK/database.dump" "$DATABASE_ADMIN_URL"

echo "==> Copying uploaded files"
if [ -d "$UPLOADS" ]; then
  cp -r "$UPLOADS" "$WORK/uploads"
else
  # An empty marker rather than a missing directory, so a restore can tell
  # "there were no files" apart from "the files were not backed up".
  mkdir -p "$WORK/uploads"
  echo "No upload directory at $UPLOADS when this backup was taken." \
    > "$WORK/uploads/.empty"
fi

# What the archive claims about itself, so a restore can be checked rather than
# assumed. The attachment count is the number that matters: it is what
# verify-backup.sh compares against the files actually present.
ATTACHMENTS="$(psql "$DATABASE_ADMIN_URL" -tAc \
  'SELECT (SELECT count(*) FROM attachments) + (SELECT count(*) FROM student_documents)' 2>/dev/null || echo 'unknown')"
FILES="$(find "$WORK/uploads" -type f ! -name '.empty' | wc -l | tr -d ' ')"

cat > "$WORK/MANIFEST" <<EOF
taken_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
database_url_host=$(printf '%s' "$DATABASE_ADMIN_URL" | sed 's|.*@||; s|/.*||')
upload_dir=$UPLOADS
attachment_rows=$ATTACHMENTS
attachment_files=$FILES
EOF

ARCHIVE="$DEST/elourwa-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" database.dump uploads MANIFEST

echo
echo "Backup written to $ARCHIVE"
echo "  attachment rows in database: $ATTACHMENTS"
echo "  attachment files in archive: $FILES"
if [ "$ATTACHMENTS" != "unknown" ] && [ "$ATTACHMENTS" != "$FILES" ]; then
  echo
  echo "⚠ THESE DO NOT MATCH. The backup is still written — it is better to hold"
  echo "  an imperfect one than none — but run scripts/verify-backup.sh to see"
  echo "  which rows have no file, before you rely on this archive."
fi
