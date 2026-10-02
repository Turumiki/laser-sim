#!/bin/sh
cd "$(dirname "$0")"
# 初回と、使うライブラリが変わったとき（package-lock.json が前回と違うとき）だけ入れ直す
if ! cmp -s package-lock.json node_modules/.installed-lock; then
  npm ci || exit 1
  cp package-lock.json node_modules/.installed-lock
fi
npm run build || exit 1
(sleep 2; open http://localhost:8765/) &
npm start
