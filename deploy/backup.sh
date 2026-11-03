#!/bin/bash
# Ежедневный бэкап данных SDonate.
# Установка на сервере:
#   mkdir -p /opt/backups
#   chmod +x /opt/sdonate/deploy/backup.sh
#   crontab -e  ->  добавить строку:  0 3 * * * /opt/sdonate/deploy/backup.sh
set -euo pipefail

DATA_DIR="/opt/sdonate/data"
BACKUP_DIR="/opt/backups"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%F_%H-%M)"
ARCHIVE="$BACKUP_DIR/sdonate-$TIMESTAMP.tar.gz"

tar -czf "$ARCHIVE" -C "$DATA_DIR" .
echo "Backup created: $ARCHIVE"

# Удаляем бэкапы старше KEEP_DAYS дней
find "$BACKUP_DIR" -name "sdonate-*.tar.gz" -mtime +$KEEP_DAYS -delete
