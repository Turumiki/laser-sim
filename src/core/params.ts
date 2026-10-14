export type RenderMode = 'clean' | 'scan';
export type ExposureShape = 'box' | 'exp';
export type ColorMode = 'single' | 'rainbow' | 'cycle' | 'source';
export type Look = 'display' | 'source';

export interface Settings {
  pattern: string;
  paused: boolean;

  mode: RenderMode;
  look: Look;
  output: string;
  fps: string;
  clip: boolean;

  offX: number;
  offY: number;
  size: number;
  angle: number;
  rotSpeed: number;

  pps: number;
  scannerK: number;
  damping: number;
  colorShift: number;
  scanAngle: number;
  pincushion: boolean;
  density: number;
  animSpeed: number;
  bpm: number;
  timeScale: number;

  exposureShape: ExposureShape;
  exposureSync: boolean;
  exposure: number;

  beam: number;
  glow: number;
  bright: number;
  head: boolean;
  showBlank: boolean;

  colorMode: ColorMode;
  color: string;
}

type KeysOf<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

// 実際のレーザーの流れに沿って分ける
// 絵柄（ILDAデータに入るもの）→ レーザー機（描く機材）→ 見え方（目・カメラ・ヘイズ）→ 出力
export type GroupId = 'content' | 'projector' | 'camera' | 'output' | 'debug';

export const GROUPS: readonly { id: GroupId; label: string }[] = [
  { id: 'content', label: '絵柄' },
  { id: 'projector', label: 'レーザー機' },
  { id: 'camera', label: '見え方' },
  { id: 'output', label: '出力' },
  // スロー再生や、ビームの位置・消灯中の経路を重ねる表示。本番の素材には入れない
  { id: 'debug', label: '補助表示' },
];

interface ParamBase {
  label: string;
  group: GroupId;
  // ツールチップ
  hint?: string;
  // この条件のときは効かない（UIで薄く表示する）
  inactive?: (s: Readonly<Settings>) => boolean;
}

export interface NumberParam extends ParamBase {
  kind: 'number';
  key: KeysOf<number>;
  min: number;
  max: number;
  // 対数スケール（ppsや露光時間のように桁で動かしたいもの）
  log?: boolean;
  digits: number;
  unit?: string;
}
export interface EnumParam extends ParamBase {
  kind: 'enum';
  key: KeysOf<string>;
  options: readonly { value: string; label: string }[];
}
export interface BoolParam extends ParamBase { kind: 'bool'; key: KeysOf<boolean> }
export interface ColorParam extends ParamBase { kind: 'color'; key: KeysOf<string> }

export type ParamDef = NumberParam | EnumParam | BoolParam | ColorParam;

// シーケンスのBPMもこの範囲（ショーを流すと、パターンのBPMがシーケンスのBPMになるので揃える）
export const BPM_RANGE = { min: 20, max: 300 } as const;

export const OUTPUT_SIZES: Record<string, readonly [number, number]> = {
  '1920x1080': [1920, 1080],
  '1080x1080': [1080, 1080],
  '1024x1024': [1024, 1024],
  '2048x2048': [2048, 2048],
};

export const PARAMS: readonly ParamDef[] = [
  { kind: 'enum', key: 'colorMode', label: '色の付け方', hint: '単色: 「色」で選んだ1色。レインボー: 線に沿って色が変わる。サイクル: 全体の色が時間とともに移り変わる。素材の色: 読み込んだ画像やILDAファイルの色をそのまま使う（それ以外のパターンでは単色）', group: 'content', options: [
    { value: 'single', label: '単色' },
    { value: 'rainbow', label: 'レインボー' },
    { value: 'cycle', label: 'サイクル' },
    { value: 'source', label: '素材の色' },
  ] },
  { kind: 'color', key: 'color', label: '色', hint: '単色のときのレーザーの色', group: 'content' },
  { kind: 'number', key: 'density', label: '点間隔', hint: '図形を点に分けるときの間隔。小さいほど点数が増え、1秒あたりの描き直し回数（pps ÷ 点数）が減る', group: 'content', min: 0.004, max: 0.1, log: true, digits: 3 },
  { kind: 'number', key: 'offX', label: '位置 X', hint: '投影位置。中央の正方形の半分を1とする', group: 'content', min: -1.78, max: 1.78, digits: 3 },
  { kind: 'number', key: 'offY', label: '位置 Y', hint: '投影位置。中央の正方形の半分を1とする', group: 'content', min: -1, max: 1, digits: 3 },
  { kind: 'number', key: 'size', label: 'サイズ', hint: '投影サイズ。1で中央の正方形いっぱい', group: 'content', min: 0.05, max: 1.5, digits: 2 },
  { kind: 'number', key: 'angle', label: '角度', hint: '図形の傾き', group: 'content', min: 0, max: 360, digits: 0, unit: '°' },
  { kind: 'number', key: 'rotSpeed', label: '回転', hint: '1秒あたりの回転量', group: 'content', min: -360, max: 360, digits: 0, unit: '°/s' },
  { kind: 'number', key: 'animSpeed', label: 'アニメ速度', hint: 'パターンの動きの速さ。0で静止', group: 'content', min: 0, max: 4, digits: 2 },
  { kind: 'number', key: 'bpm', label: 'BPM', hint: 'ビートに合わせて動くパターン（ストロボ・チェイス・ビームウェーブなど）のテンポ。シーケンスを流すと、シーケンスのBPMになる。アニメ速度を2にすると倍の速さ', group: 'content', ...BPM_RANGE, digits: 0 },

  { kind: 'enum', key: 'mode', label: '描画方式', hint: 'ベクター: 図形をそのまま、きれいな線で描く。スキャン: pps・スキャナ性能・ダンピング・カラーシフトを反映して、実機の見え方を再現する', group: 'projector', options: [
    { value: 'clean', label: 'ベクター' },
    { value: 'scan', label: 'スキャン' },
  ] },
  { kind: 'number', key: 'pps', label: 'pps', hint: '1秒あたりに出力する点の数。スキャナの性能はILDAテストパターンを描ける pps で表す', group: 'projector', min: 1000, max: 60000, digits: 0 },
  { kind: 'number', key: 'scannerK', label: 'スキャナ性能', hint: 'ILDAテストパターンを正しく描ける pps（走査角8°）。低いほど角が丸くなり、円が小さくなる', group: 'projector', min: 5, max: 80, digits: 0, unit: 'kpps' },
  { kind: 'number', key: 'damping', label: 'ダンピング', hint: 'ミラーの揺れを抑える強さ。小さいと角で行き過ぎて揺れ（オーバーシュート）、大きいと角が丸くなる', group: 'projector', min: 0.2, max: 1.5, digits: 2 },
  { kind: 'number', key: 'colorShift', label: 'カラーシフト', hint: '色（点灯・消灯を含む）を座標に対して遅らせる時間。ミラーの遅れに合わせる補正。合っていないと角や線の端で色がはみ出す', group: 'projector', min: -200, max: 500, digits: 0, unit: 'µs' },
  { kind: 'number', key: 'scanAngle', label: '最大走査角', hint: 'レーザー機が振れる最大の角度（光学角）。映像の正方形の幅がこの角度になる。Unityのスポットライトの角度はこれに合わせる。大きいほどミラーを大きく振るので、同じサイズでも図形が崩れやすい', group: 'projector', min: 5, max: 90, digits: 0, unit: '°' },
  { kind: 'bool', key: 'pincushion', label: '糸巻きゆがみ', hint: 'X用とY用の2枚のミラーで振るため、平面に映すと四隅が外へ引っぱられた形（糸巻き型）になる。走査角が大きいほど目立つ', group: 'projector' },
  { kind: 'number', key: 'beam', label: 'ビーム径', hint: 'ビームの太さ。1920×1080の画面に換算したピクセル数', group: 'projector', min: 0.5, max: 10, digits: 1, unit: 'px' },

  { kind: 'enum', key: 'exposureShape', label: '露光方式', hint: 'シャッター: 露光時間内の光を均等に積算する（カメラ）。残像: 古い光ほど暗くなる（目）', group: 'camera', options: [
    { value: 'box', label: 'シャッター' },
    { value: 'exp', label: '残像' },
  ] },
  { kind: 'bool', key: 'exposureSync', label: '1コマに合わせる', hint: '露光時間を映像の1コマ（1 ÷ 映像のfps）にする。コマの間に写らない時間ができない。映像のfpsは「出力」で設定', group: 'camera' },
  { kind: 'number', key: 'exposure', label: '露光時間', hint: '光を積算する時間。60fpsなら16.7ms（1/60秒）で1コマ分', group: 'camera', inactive: s => s.exposureSync, min: 0.2, max: 200, log: true, digits: 1, unit: 'ms' },
  { kind: 'number', key: 'glow', label: 'グロー', hint: 'ビーム周辺のにじみ。ヘイズやレンズでの散乱に相当。クッキー用では使わない', group: 'camera', inactive: s => s.look === 'source', min: 0, max: 3, digits: 2 },
  { kind: 'number', key: 'bright', label: '明るさ', hint: '露光量。上げると強く当たった部分が白く飛ぶ', group: 'camera', min: 0.1, max: 5, log: true, digits: 2 },

  { kind: 'enum', key: 'look', label: '用途', hint: '表示用: そのまま画面に映す見た目（強い所は白く飛び、にじみが付く）。クッキー用: Unity・Unreal・TouchDesigner などで、ライトのクッキー（光の模様を決めるテクスチャ）やボリュームライトの元にする映像。白飛びとにじみを入れず、明るさは光量に比例させる。出力サイズは正方形がおすすめ', group: 'output', options: [
    { value: 'display', label: '表示用' },
    { value: 'source', label: 'クッキー用' },
  ] },
  { kind: 'enum', key: 'output', label: '出力サイズ', hint: '出力解像度。レーザーの描画範囲は常に中央の正方形', group: 'output',
    options: Object.keys(OUTPUT_SIZES).map(v => ({ value: v, label: v.replace('x', ' × ') })) },
  { kind: 'enum', key: 'fps', label: '映像のfps', hint: '書き出し・録画のfpsと、「1コマに合わせる」露光の基準。OBSのブラウザソースも同じfpsにする', group: 'output', options: [
    { value: '24', label: '24' },
    { value: '30', label: '30' },
    { value: '50', label: '50' },
    { value: '60', label: '60' },
  ] },
  { kind: 'bool', key: 'clip', label: '正方形でクリップ', hint: '中央の正方形の外を描かない', group: 'output' },

  { kind: 'number', key: 'timeScale', label: 'スロー', hint: '時間の進み方。1で実時間', group: 'debug', min: 0.0003, max: 1, log: true, digits: 4, unit: '×' },
  { kind: 'bool', key: 'head', label: '先頭の点', hint: '現在のビーム位置を表示する', group: 'debug' },
  { kind: 'bool', key: 'showBlank', label: 'ブランキング表示', hint: '消灯中の移動経路を灰色で表示する', group: 'debug' },
];

export const DEFAULTS: Readonly<Settings> = {
  pattern: 'circle',
  paused: false,
  mode: 'scan',
  look: 'display',
  output: '1920x1080',
  fps: '60',
  clip: false,
  offX: 0,
  offY: 0,
  size: 0.85,
  angle: 0,
  rotSpeed: 0,
  pps: 30000,
  scannerK: 30,
  // 30Kのスキャナを30kppsでILDAテスト風に合わせた値（円が四角に接する）
  damping: 0.6,
  colorShift: 80,
  scanAngle: 40,
  pincushion: true,
  density: 0.025,
  animSpeed: 1,
  bpm: 128,
  timeScale: 1,
  exposureShape: 'box',
  exposureSync: true,
  exposure: 1000 / 60,
  beam: 2.2,
  glow: 1,
  bright: 1,
  head: false,
  showBlank: false,
  colorMode: 'single',
  color: '#00ff40',
};

export const PRESETS: Record<string, { label: string; title: string; values: Partial<Settings> }> = {
  real: { label: '等速', title: '実機と同じ速さ', values: { timeScale: 1, exposureShape: 'box', exposureSync: true, head: false, showBlank: false } },
  slow50: { label: '1/50', title: 'スキャンを1/50の速さで再生', values: { timeScale: 0.02, exposureShape: 'exp', exposureSync: false, exposure: 8, head: true, showBlank: false } },
  slow500: { label: '1/500', title: 'スキャンを1/500の速さで再生（ブランキング表示つき）', values: { timeScale: 0.002, exposureShape: 'exp', exposureSync: false, exposure: 1.5, head: true, showBlank: true } },
};

const byKey = new Map<string, ParamDef>(PARAMS.map(p => [p.key, p]));
export const paramOf = (key: string) => byKey.get(key);

// 全チャンネル共通の設定のグループ（見え方・出力・補助表示）。残り（絵柄・レーザー機）はレーザーごと
export const SHARED_GROUPS: readonly GroupId[] = ['camera', 'output', 'debug'];
export const isShared = (key: string) => {
  const p = byKey.get(key);
  return !!p && SHARED_GROUPS.includes(p.group);
};

// 数値の設定を、その項目の範囲に収める
export function clampParam(key: NumberParam['key'], v: number) {
  const p = byKey.get(key);
  return p?.kind === 'number' ? Math.min(p.max, Math.max(p.min, v)) : v;
}

export function outputSize(s: Pick<Settings, 'output'>): readonly [number, number] {
  return OUTPUT_SIZES[s.output] ?? OUTPUT_SIZES['1920x1080'];
}

const toBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

// 外から来た値（URL、同期、API）を型と範囲に揃える。知らないキーは捨てる
export function sanitize(input: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'pattern') { if (typeof v === 'string' && v) out.pattern = v; continue; }
    if (k === 'paused') { out.paused = toBool(v); continue; }
    const p = byKey.get(k);
    if (!p) continue;
    switch (p.kind) {
      case 'number': {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = Math.min(p.max, Math.max(p.min, n));
        break;
      }
      case 'enum':
        if (p.options.some(o => o.value === v)) out[k] = v;
        break;
      case 'bool':
        out[k] = toBool(v);
        break;
      case 'color':
        if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v.toLowerCase();
        break;
    }
  }
  return out as Partial<Settings>;
}
