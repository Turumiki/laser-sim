# ILDA Laser Sim

ILDAレーザー風の映像を作るツール。OBSのブラウザソースで取り込んで使う想定。

## 必要なもの

Node.js 22.18 以上

## 起動

- Mac: `start.command` をダブルクリック
- Windows: `start.bat` をダブルクリック
- 手動: `npm install` → `npm run build` → `npm start`

`http://localhost:8765/` が操作画面、`/output.html` がOBS用の出力。
同じLAN内の別PCからも開ける（起動時にアドレスが出る）。

## OBS

ブラウザソースを追加して、操作画面の「URLをコピー」で取ったURLを貼る。
幅と高さは出力サイズ（初期値 1920×1080）に合わせる。
負荷を見たいときはURLに `?stats=1` を付ける。

## 操作

- ビューア: ドラッグで移動、ホイールでサイズ、Shift+ドラッグ / Shift+ホイールで角度、ダブルクリックで中央
- インスペクター: 項目名を左右にドラッグで値が変わる（Shiftで細かく）
- Space: 一時停止

## API

```sh
curl -X POST http://localhost:8765/api/state -d '{"pattern":"star","rotSpeed":90}'
```

チャンネルを分けるときは `?ch=名前`（操作画面、出力、APIで共通）。

## 開発

```sh
npm run dev        # 保存するとブラウザに反映される
npm run typecheck
```
