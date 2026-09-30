export type RenderMode = 'clean' | 'scan';
export type ExposureShape = 'box' | 'exp';
export type ColorMode = 'single' | 'rainbow' | 'cycle';

export interface Settings {
  pattern: string;
  paused: boolean;

  mode: RenderMode;
  output: string;
  clip: boolean;

  offX: number;
  offY: number;
  size: number;
  angle: number;
  rotSpeed: number;

  pps: number;
  lag: number;
  density: number;
  animSpeed: number;
  timeScale: number;

  exposureShape: ExposureShape;
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
  // 検証用の表示。本番の素材には入れない
  { id: 'debug', label: '観察用' },
];

interface ParamBase { label: string; group: GroupId }

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

export const OUTPUT_SIZES: Record<string, readonly [number, number]> = {
  '1920x1080': [1920, 1080],
  '1080x1080': [1080, 1080],
  '1024x1024': [1024, 1024],
  '2048x2048': [2048, 2048],
};

export const PARAMS: readonly ParamDef[] = [
  { kind: 'enum', key: 'colorMode', label: 'カラー', group: 'content', options: [
    { value: 'single', label: '単色' },
    { value: 'rainbow', label: 'レインボー' },
    { value: 'cycle', label: 'サイクル' },
  ] },
  { kind: 'color', key: 'color', label: '色', group: 'content' },
  { kind: 'number', key: 'density', label: '点間隔', group: 'content', min: 0.004, max: 0.1, log: true, digits: 3 },
  { kind: 'number', key: 'offX', label: '位置 X', group: 'content', min: -1.78, max: 1.78, digits: 3 },
  { kind: 'number', key: 'offY', label: '位置 Y', group: 'content', min: -1, max: 1, digits: 3 },
  { kind: 'number', key: 'size', label: 'サイズ', group: 'content', min: 0.05, max: 1.5, digits: 2 },
  { kind: 'number', key: 'angle', label: '角度', group: 'content', min: 0, max: 360, digits: 0, unit: '°' },
  { kind: 'number', key: 'rotSpeed', label: '回転', group: 'content', min: -360, max: 360, digits: 0, unit: '°/s' },
  { kind: 'number', key: 'animSpeed', label: 'アニメ速度', group: 'content', min: 0, max: 4, digits: 2 },

  { kind: 'enum', key: 'mode', label: '描画方式', group: 'projector', options: [
    { value: 'clean', label: '理想' },
    { value: 'scan', label: '実機' },
  ] },
  { kind: 'number', key: 'pps', label: 'pps', group: 'projector', min: 1000, max: 60000, digits: 0 },
  { kind: 'number', key: 'lag', label: 'ガルバ遅れ', group: 'projector', min: 0, max: 1, digits: 2, unit: 'ms' },
  { kind: 'number', key: 'beam', label: 'ビーム径', group: 'projector', min: 0.5, max: 10, digits: 1, unit: 'px' },

  { kind: 'enum', key: 'exposureShape', label: '露光方式', group: 'camera', options: [
    { value: 'box', label: 'シャッター' },
    { value: 'exp', label: '残像' },
  ] },
  { kind: 'number', key: 'exposure', label: '露光時間', group: 'camera', min: 0.2, max: 200, log: true, digits: 1, unit: 'ms' },
  { kind: 'number', key: 'glow', label: 'グロー', group: 'camera', min: 0, max: 3, digits: 2 },
  { kind: 'number', key: 'bright', label: '明るさ', group: 'camera', min: 0.1, max: 5, log: true, digits: 2 },

  { kind: 'enum', key: 'output', label: '出力サイズ', group: 'output',
    options: Object.keys(OUTPUT_SIZES).map(v => ({ value: v, label: v.replace('x', ' × ') })) },
  { kind: 'bool', key: 'clip', label: '正方形でクリップ', group: 'output' },

  { kind: 'number', key: 'timeScale', label: 'スロー', group: 'debug', min: 0.0003, max: 1, log: true, digits: 4, unit: '×' },
  { kind: 'bool', key: 'head', label: '先頭の点', group: 'debug' },
  { kind: 'bool', key: 'showBlank', label: 'ブランキング表示', group: 'debug' },
];

export const DEFAULTS: Readonly<Settings> = {
  pattern: 'circle',
  paused: false,
  mode: 'scan',
  output: '1920x1080',
  clip: false,
  offX: 0,
  offY: 0,
  size: 0.85,
  angle: 0,
  rotSpeed: 0,
  pps: 30000,
  lag: 0.12,
  density: 0.025,
  animSpeed: 1,
  timeScale: 1,
  exposureShape: 'box',
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
  real: { label: '等速', title: '実機と同じ速さ', values: { timeScale: 1, exposureShape: 'box', exposure: 1000 / 60, pps: 30000, head: false, showBlank: false } },
  slow50: { label: '1/50', title: 'スキャンを1/50の速さで観察', values: { timeScale: 0.02, exposureShape: 'exp', exposure: 8, head: true, showBlank: false } },
  slow500: { label: '1/500', title: 'スキャンを1/500の速さで観察（ブランキング表示つき）', values: { timeScale: 0.002, exposureShape: 'exp', exposure: 1.5, head: true, showBlank: true } },
  lowPps: { label: '低pps', title: '6kppsで描いたときのちらつき', values: { timeScale: 1, exposureShape: 'box', exposure: 1000 / 60, pps: 6000, head: false, showBlank: false } },
};

const byKey = new Map<string, ParamDef>(PARAMS.map(p => [p.key, p]));
export const paramOf = (key: string) => byKey.get(key);

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
