#!/bin/bash
cd "$(dirname "$0")"
( sleep 1; open "http://localhost:8765/" ) &
python3 serve.py 8765
