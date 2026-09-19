#!/usr/bin/env sh
cd "$(dirname "$0")/.." || exit 1
python3 tools/time_reviewer.py
