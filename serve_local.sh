#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
echo "MoonGrinder is available at http://localhost:8000"
echo "Press Ctrl+C to stop the local server."
python3 -m http.server 8000
