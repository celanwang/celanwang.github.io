#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP="/var/www/byte-cloud.bak.$(date +%Y%m%d%H%M%S)"

docker run --rm -v "$ROOT":/app -w /app node:20-bookworm-slim npm run build
cp -a /var/www/byte-cloud "$BACKUP"
rsync -a --delete "$ROOT/dist/" /var/www/byte-cloud/
nginx -t
systemctl reload nginx
echo "Deployed. Backup: $BACKUP"
