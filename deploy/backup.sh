#!/usr/bin/env bash
# Ежедневный бэкап: БД + медиа → S3 Timeweb. Cron: 30 3 * * * /opt/top-barbershop/deploy/backup.sh
set -euo pipefail
cd /opt/top-barbershop
source .env
TS=$(date +%F)
mkdir -p backups
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "backups/db-$TS.sql.gz"
docker run --rm -v top-barbershop_media:/m -v "$PWD/backups:/b" alpine tar czf "/b/media-$TS.tgz" -C /m .
# Выгрузка в S3 (нужны S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY в .env)
if [ -n "${S3_BUCKET:-}" ]; then
  docker run --rm -v "$PWD/backups:/b" -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY amazon/aws-cli \
    --endpoint-url https://s3.twcstorage.ru s3 sync /b "s3://$S3_BUCKET/backups/" --exclude "*" --include "*-$TS.*"
fi
find backups -type f -mtime +7 -delete
