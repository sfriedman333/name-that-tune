#!/usr/bin/env bash
# Run on a machine that can reach Cloudflare (e.g. Scott's Mac).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3847}"
node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1
if command -v cloudflared >/dev/null; then
  cloudflared tunnel --url "http://127.0.0.1:${PORT}"
elif command -v npx >/dev/null; then
  npx --yes localtunnel --port "${PORT}"
else
  echo "Install cloudflared or use: npx localtunnel --port ${PORT}"
  wait "$SERVER_PID"
fi
