#!/bin/bash
set -euo pipefail

# SQLite daily backup script for FAS Operations
# Usage: ./scripts/backup_sqlite.sh [--verify]

PROJECT_DIR="${PROJECT_DIR:-$HOME/FAS-operations}"
SQLITE_PATH="$PROJECT_DIR/state/tasks.sqlite"
ICLOUD_BACKUP_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/fas-backups/sqlite"
EXTERNAL_BACKUP_DIR="/Volumes/External6TB/fas-backups/sqlite"
LOG_FILE="$PROJECT_DIR/logs/backup.log"
BACKUP_RETENTION_DAYS=30
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILENAME="tasks_${TIMESTAMP}.sqlite"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Create dirs
mkdir -p "$ICLOUD_BACKUP_DIR" "$(dirname "$LOG_FILE")"

# Check source exists
if [ ! -f "$SQLITE_PATH" ]; then
  log "ERROR: Source DB not found: $SQLITE_PATH"
  exit 1
fi

# Backup using sqlite3 .backup (WAL-safe)
log "Starting backup: $BACKUP_FILENAME"
TEMP_BACKUP="/tmp/$BACKUP_FILENAME"
sqlite3 "$SQLITE_PATH" ".backup '$TEMP_BACKUP'"

# Verify backup integrity
if ! sqlite3 "$TEMP_BACKUP" "PRAGMA integrity_check;" | grep -q "ok"; then
  log "ERROR: Backup integrity check FAILED"
  rm -f "$TEMP_BACKUP"
  exit 2
fi
log "Integrity check: OK"

# Copy to iCloud
cp "$TEMP_BACKUP" "$ICLOUD_BACKUP_DIR/$BACKUP_FILENAME"
log "Copied to iCloud: $ICLOUD_BACKUP_DIR/$BACKUP_FILENAME"

# Copy to external drive if mounted
if [ -d "$EXTERNAL_BACKUP_DIR" ] || mkdir -p "$EXTERNAL_BACKUP_DIR" 2>/dev/null; then
  cp "$TEMP_BACKUP" "$EXTERNAL_BACKUP_DIR/$BACKUP_FILENAME" 2>/dev/null && \
    log "Copied to external: $EXTERNAL_BACKUP_DIR/$BACKUP_FILENAME" || \
    log "WARN: External drive not available, skipping"
else
  log "WARN: External drive not mounted, skipping"
fi

# Cleanup temp
rm -f "$TEMP_BACKUP"

# Retention: delete backups older than N days
find "$ICLOUD_BACKUP_DIR" -name "tasks_*.sqlite" -mtime +$BACKUP_RETENTION_DAYS -delete 2>/dev/null && \
  log "Cleaned up backups older than ${BACKUP_RETENTION_DAYS} days" || true

if [ -d "$EXTERNAL_BACKUP_DIR" ]; then
  find "$EXTERNAL_BACKUP_DIR" -name "tasks_*.sqlite" -mtime +$BACKUP_RETENTION_DAYS -delete 2>/dev/null || true
fi

# Optional: run TypeScript integrity verification
if [ "${1:-}" = "--verify" ]; then
  log "Running detailed integrity verification..."
  cd "$PROJECT_DIR"
  LATEST_BACKUP="$ICLOUD_BACKUP_DIR/$BACKUP_FILENAME"
  npx tsx src/backup/verify_backup_integrity.ts "$SQLITE_PATH" "$LATEST_BACKUP" 2>&1 | tee -a "$LOG_FILE"
fi

log "Backup complete: $BACKUP_FILENAME"
exit 0
