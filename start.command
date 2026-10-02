#!/bin/sh
cd "$(dirname "$0")"
# ダブルクリックで開くとシェルの設定が読まれないので、Node.js のよくある置き場所を足しておく
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
CHECK='const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)'
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が入っていません。開いたページから LTS 版を入れてから、もう一度起動してください。"
  open https://nodejs.org/
  exit 1
fi
if ! node -e "$CHECK"; then
  echo "Node.js が古いです（今: $(node -v)、必要: 22.18 以上）。開いたページから LTS 版を入れ直してください。"
  open https://nodejs.org/
  exit 1
fi
# 初回と、使うライブラリが変わったとき（package-lock.json が前回と違うとき）だけ入れ直す
if ! cmp -s package-lock.json node_modules/.installed-lock; then
  npm ci || exit 1
  cp package-lock.json node_modules/.installed-lock
fi
npm run build || exit 1
(sleep 2; open http://localhost:8765/) &
npm start
