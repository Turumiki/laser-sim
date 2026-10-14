# ILDA Laser Sim

ILDA レーザーの出力をブラウザ上でシミュレートし、映像として出すツール。OBS のブラウザソースでの取り込みを想定している。

## 動作環境

[Node.js](https://nodejs.org/) 22.18 以上（LTS 推奨）

## 起動

リポジトリを clone するか、ZIP を展開する。

- macOS: `start.command` を実行
  - 初回は Gatekeeper にブロックされることがある。その場合は右クリック →「開く」
- Windows: `start.bat` を実行
  - 他のマシンから接続する場合は、ファイアウォールで受信を許可する
- 手動: `npm ci` → `npm run build` → `npm start`

初回起動時と依存パッケージの更新時は、`npm ci` に時間がかかる。起動後、操作画面がブラウザで開く。

| 画面 | URL |
|---|---|
| 操作画面 | `http://localhost:8765/` |
| 出力（OBS 用） | `http://localhost:8765/output.html` |
| 3D ビューア | `http://localhost:8765/viewer.html` |

LAN 内の他のマシンからも接続できる（起動時に URL を表示）。読み込んだ素材とシーケンスはリポジトリ内に保存され、Git の管理対象外。

## OBS

ブラウザソースを追加し、操作画面の「URLをコピー」で取得した URL を指定する。
幅・高さは出力解像度（既定 1920×1080）に合わせる。
負荷を確認する場合は、URL に `?stats=1` を付ける。

クッキーやボリュームライトのソースに使う場合は、ツールバーの「ポストエフェクト」をオフにする。
グローと白飛びの処理を通さず、光量にリニアな値を sRGB で出力する。
出力解像度は正方形（1080×1080 など）が扱いやすい。

## 操作

- ビューア: ドラッグで移動、ホイールで拡縮、Shift+ドラッグ / Shift+ホイールで回転、ダブルクリックで中央に戻す
- インスペクター: 項目名の左右ドラッグで値を変更（Shift で微調整）
- Space: 一時停止

## 素材

パターンの「素材」から PNG・JPG・SVG・ILDA（.ild）を読み込める。サーバーの `.assets/` に保存され、全チャンネル・出力・3D ビューアで共有される。

- PNG・JPG: 色ごとに輪郭を抽出してベクター化する。背景（四隅の色または透過）は除外。ロゴなど、色の境界がはっきりした画像向け
- SVG: パスと図形をそのまま読む。テキストは非対応のため、アウトライン化して書き出す
- ILDA: フォーマット 0・1・2・4・5。フレームはファイル順に再生する。フレームレートは素材ごとに設定でき、既定は 30fps（アニメ速度の倍率がかかる）

「色の付け方: 素材の色」で、素材の色をそのまま使う。SVG の黒はレーザーで出せないため白に置き換える。
点数がスキャンレートに対して多すぎると 1 フレーム内に描き切れず、一部しか描画されない。読み込み時に点数とリフレッシュレートを表示する。

## API

チャンネルは `?ch=<名前>` で指定する（操作画面・出力・API で共通。省略時は `default`）。

| メソッド | パス | 内容 |
|---|---|---|
| GET / POST | `/api/state` | 設定の取得・変更（POST は差分を送る） |
| GET / POST | `/api/show` | シーケンスの状態取得・操作 |
| GET | `/api/channels` | 使用中のチャンネル一覧 |
| GET / POST | `/api/assets` | 素材の一覧・追加 |
| GET / PATCH / DELETE | `/api/assets/<id>` | 素材の取得・フレームレート変更・削除 |

```sh
curl -X POST http://localhost:8765/api/state -d '{"pattern":"star","rotSpeed":90}'
```

シーケンスの再生・停止:

```sh
curl -X POST http://localhost:8765/api/show -d '{"action":"play","id":"opening"}'
curl -X POST http://localhost:8765/api/show -d '{"action":"stop"}'
```

組み込みのシーケンスは `opening`・`festival`・`beams`・`graphics`・`beat`（BPM 同期パターンのみ）・`vocal`（歌ものライブを想定した通しの構成）。操作画面で作成したものは `custom`。

複数チャンネルの同時スタート（`channels` を省略すると全チャンネル）:

```sh
curl -X POST http://localhost:8765/api/show -d '{"action":"playAll","id":"custom","channels":["arena-l","arena-c","arena-r"]}'
```

素材（パターン名は `asset:<id>`）:

```sh
curl http://localhost:8765/api/assets
curl -X POST http://localhost:8765/api/state -d '{"pattern":"asset:<id>","colorMode":"source"}'
curl -X PATCH http://localhost:8765/api/assets/<id> -d '{"fps":24}'
curl -X DELETE http://localhost:8765/api/assets/<id>
```

## 3D ビューア

会場やレーザー機の配置はクエリパラメータでも指定できる。

```
/viewer.html?target=arena&count=6&spacing=6&layout=mirror&assign=arena-l,arena-l,arena-c,arena-c,arena-r,arena-r&view=foh
```

WebXR に対応したヘッドセット（PC VR、またはスタンドアロン機のブラウザ）では、右上の「VRで見る」から会場内に入れる。WebXR はセキュアコンテキストが必須のため、localhost 以外から開く場合は HTTPS で配信する（Tailscale なら `tailscale serve --bg 8765`）。VR 中はコントローラのトリガーで視点を切り替える。描画は点データのみで、ブルームはかからない。

## 開発

```sh
npm run dev        # ホットリロード
npm run typecheck
npm run lint
npm test
```

開発サーバーに `.local` 以外のホスト名でアクセスする場合は、`.env.local` に `DEV_ALLOWED_HOSTS=.example.net` のようにカンマ区切りで指定する。
