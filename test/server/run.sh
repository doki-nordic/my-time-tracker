#!/usr/bin/env bash
# Start a PHP development server in Docker, serving files from dist/.
# Usage: bash test/server/run.sh [port]

set -euo pipefail

PORT="${1:-8080}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

if [[ ! -d "$DIST_DIR" ]]; then
  echo "dist/ not found. Run 'npm run build' first."
  exit 1
fi

# Try to make dist and files writable so Apache in container can update token.php.
# This can fail if dist is owned by another user from a previous container run.
if ! chmod -R a+rwX "$DIST_DIR" 2>/dev/null; then
  echo "Warning: could not chmod dist/ (owner mismatch). Continuing with existing permissions."
fi

echo "Serving dist/ at http://localhost:$PORT"
echo "Press Ctrl+C to stop."

docker run --rm -it \
  -v "$DIST_DIR:/var/www/html" \
  -p "$PORT:80" \
  php:8-apache
