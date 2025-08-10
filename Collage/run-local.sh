#!/data/data/com.termux/files/usr/bin/bash
set -e
PORT="${1:-8080}"
echo "Serving on http://127.0.0.1:$PORT"
python -m http.server "$PORT"
