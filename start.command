#!/bin/sh
cd "$(dirname "$0")"
[ -d node_modules ] || npm install || exit 1
npm run build || exit 1
(sleep 2; open http://localhost:8765/) &
npm start
