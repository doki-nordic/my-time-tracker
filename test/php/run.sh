#!/usr/bin/env bash
# Run PHP endpoint tests against an Apache+PHP Docker container.
# Usage: bash test/php/run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT=8787
CONTAINER_NAME="work-status-php-test"
BASE="http://localhost:$PORT"

echo "Building project..."
cd "$PROJECT_DIR"
npm run build

# Clean up any leftover container
docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true

cleanup() {
  docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
  # Restore ownership of dist/ files that Apache (root/www-data) may have created
  docker run --rm -v "$PROJECT_DIR/dist:/dist" alpine chown -R "$(id -u):$(id -g)" /dist 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting Apache+PHP container..."
docker run -d --rm \
  --name "$CONTAINER_NAME" \
  -v "$PROJECT_DIR/dist:/var/www/html" \
  -v "$SCRIPT_DIR/test-all.php:/app/test-all.php:ro" \
  -p "$PORT:80" \
  php:8-apache > /dev/null

# Wait for Apache to be ready
for i in $(seq 1 20); do
  if curl -s -o /dev/null "$BASE/" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

echo "Running tests..."
docker exec "$CONTAINER_NAME" \
  php /app/test-all.php "http://localhost:80" /var/www/html
