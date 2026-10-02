# ILDA Laser Sim

ILDAレーザー風の映像を作るツール。OBSのブラウザソースで取り込んで使う想定。

## 必要なもの

[Node.js](https://nodejs.org/) 22.18 以上（LTS版を入れればよい）

## 起動

リポジトリを `git clone` するか、ZIPでダウンロードして展開する。

- Mac: `start.command` をダブルクリック
  - 初回は「開発元を確認できない」と止められることがある。そのときは右クリック →「開く」
- Windows: `start.bat` をダブルクリック
  - 別のPCから開くときは、ファイアウォールの確認で「許可」にする
- 手動: `npm ci` → `npm run build` → `npm start`

初回と、更新して使うライブラリが変わったときは、ライブラリの取得に少し時間がかかる。起動するとブラウザで操作画面が開く。

| 画面 | アドレス |
|---|---|
| 操作画面 | `http://localhost:8765/` |
| OBS用の出力 | `http://localhost:8765/output.html` |
| 3Dビューア | `http://localhost:8765/viewer.html` |

同じLAN内の別PCからも開ける（起動時にアドレスが出る）。読み込んだ素材や作ったショーはこのフォルダの中に保存され、Gitには入らない。

## OBS

ブラウザソースを追加して、操作画面の「URLをコピー」で取ったURLを貼る。
幅と高さは出力サイズ（初期値 1920×1080）に合わせる。
負荷を見たいときはURLに `?stats=1` を付ける。

クッキーやボリュームライトの元にするときは、ツールバーで「クッキー用」にする。
白飛びとにじみが入らず、明るさが光量に比例した映像（sRGB）になる。
出力サイズは正方形（1080×1080 など）にすると扱いやすい。

## 操作

- ビューア: ドラッグで移動、ホイールでサイズ、Shift+ドラッグ / Shift+ホイールで角度、ダブルクリックで中央
- インスペクター: 項目名を左右にドラッグで値が変わる（Shiftで細かく）
- Space: 一時停止

## 素材の読み込み

パターンの「素材」から、PNG・JPG・SVG・ILDAファイル（.ild）を読み込める。読み込んだものはサーバーの `.assets/` に置かれ、全チャンネル・出力・3Dビューアから使える。

- PNG・JPG: 色ごとの輪郭をなぞって線にする。背景（四隅の色か透明）はなぞらない。ロゴのようなはっきりした絵向け
- SVG: 線と図形をそのまま読む。文字は読まないので、アウトライン化してから書き出す
- ILDA: 形式 0・1・2・4・5。コマはファイルの順に 30fps で回す（アニメ速度で変わる）

色は「カラー: 素材の色」で、画像やファイルの色のまま描く。黒い線は見えないので白にする。
点が多いと1コマの間に描き切れず、一部ずつしか写らない。読み込んだときに点の数と1秒あたりの描き直しの回数が出る。

## API

```sh
curl -X POST http://localhost:8765/api/state -d '{"pattern":"star","rotSpeed":90}'
```

ショー（シーケンス）の再生と停止:

```sh
curl -X POST http://localhost:8765/api/show -d '{"action":"play","id":"opening"}'
curl -X POST http://localhost:8765/api/show -d '{"action":"stop"}'
```

組み込みのショーは `opening`、`festival`、`beams`、`graphics`、`beat`（ビートで動くパターンだけのもの）、`vocal`（歌もののライブ向けに、イントロからアウトロまで通しで組んだもの）。操作画面で作ったものは `custom`。

複数のチャンネルを同じ瞬間に始める（`channels` を省くと全チャンネル）:

```sh
curl -X POST http://localhost:8765/api/show -d '{"action":"playAll","id":"custom","channels":["arena-l","arena-c","arena-r"]}'
```

素材の一覧・取得・削除（パターン名は `asset:<id>`）:

```sh
curl http://localhost:8765/api/assets
curl -X POST http://localhost:8765/api/state -d '{"pattern":"asset:<id>","colorMode":"source"}'
curl -X DELETE http://localhost:8765/api/assets/<id>
```

3Dビューアは、URLで会場や台の並べ方を指定できる:

```
/viewer.html?target=arena&count=6&spacing=6&layout=mirror&assign=arena-l,arena-l,arena-c,arena-c,arena-r,arena-r&view=foh
```

VRのヘッドセット（PCにつないだもの、またはヘッドセットのブラウザ）があれば、右上の「VRで見る」から会場に入れる。WebXRは https でしか動かないので、別のPCから開くときは https で配信する（Tailscale なら `tailscale serve --bg 8765`）。VRの中ではコントローラのトリガーで視点を切り替える。描き方は点のデータだけで、ブルームは付かない。

チャンネルを分けるときは `?ch=名前`（操作画面、出力、APIで共通）。

## 開発

```sh
npm run dev        # 保存するとブラウザに反映される
npm run typecheck
```
