#!/usr/bin/env bash
# Upload dist/ to a remote FTPS server.
#
# Usage:
#   FTP_PWD='secret' bash test/send/send.sh <host> <user> <remote_dir> [port]
#
# Example:
#   FTP_PWD='secret' bash test/send/send.sh ftp.example.com deploy /public_html/work-status 21

set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: FTP_PWD=<password> bash test/send/send.sh <host> <user> <remote_dir> [port]"
  echo "Example: FTP_PWD='secret' bash test/send/send.sh ftp.example.com deploy /public_html/work-status 21"
  exit 0
fi

HOST="${1:-}"
USER_NAME="${2:-}"
REMOTE_DIR="${3:-}"
PORT="${4:-21}"

if [[ -z "$HOST" || -z "$USER_NAME" || -z "$REMOTE_DIR" ]]; then
  echo "Error: missing required arguments." >&2
  echo "Usage: FTP_PWD=<password> bash test/send/send.sh <host> <user> <remote_dir> [port]" >&2
  exit 1
fi

if [[ -z "${FTP_PWD:-}" ]]; then
  echo "Error: FTP_PWD environment variable is not set." >&2
  exit 1
fi

if ! command -v lftp >/dev/null 2>&1; then
  echo "Error: lftp is required but not installed." >&2
  echo "Install it, for example: sudo apt-get install lftp" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$PROJECT_DIR/dist"

if [[ ! -d "$DIST_DIR" ]]; then
  echo "Error: dist/ not found. Run 'npm run build' first." >&2
  exit 1
fi

echo "Uploading $DIST_DIR to FTPS://$HOST:$PORT$REMOTE_DIR"

auth_url="ftp://$HOST"

lftp -u "$USER_NAME","$FTP_PWD" -p "$PORT" "$auth_url" <<EOF
set cmd:fail-exit true
set net:max-retries 2
set net:timeout 20
set ftp:ssl-force true
set ftp:ssl-protect-data true
set ssl:verify-certificate false

# Ensure the target directory exists, then upload deployable files only.
mirror -R --verbose \
  --exclude-glob uid.php \
  --exclude-glob token.php \
  --exclude-glob status.json \
  "$DIST_DIR" "$REMOTE_DIR"
bye
EOF

echo "Upload completed."
