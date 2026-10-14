import type { Pattern } from './registry.ts';

const TAU = Math.PI * 2;
const tri = (u: number) => 1 - Math.abs(2 * u - 1);

// ヘイズの中で光の筋として見せる前提の演出
export const beams: Pattern[] = [
  {
    // 客席の上に張る水平の光の膜。上下にゆっくり動かし、少し波打たせる
    id: 'liquidsky', name: 'リキッドスカイ', category: 'beam',
    hint: '客席の上に張る水平の光の膜。ヘイズの中で天井のように見える',
    draw(f, t) {
      const base = 0.5 + 0.2 * Math.sin(t * 0.6);
      f.curve((u, p) => {
        const x = -0.95 + 1.9 * tri(u);
        p.x = x;
        p.y = base + 0.04 * Math.sin(x * 5 - t * 2);
      });
    },
  },
  {
    // 何も出さない。ショーの中で暗転やストロボに使う
    id: 'blackout', name: 'ブラックアウト', category: 'beam',
    hint: '何も出さない。暗転やストロボに使う',
    draw(f) {
      f.moveTo(0, 0);
    },
  },
  {
    // 点を多く並べ、開いたり閉じたりさせる
    id: 'multifan', name: 'マルチファン', category: 'beam',
    hint: '13本のビームが開いたり閉じたりする扇',
    draw(f, t) {
      const n = 13;
      const spread = 0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.3));
      for (let i = 0; i < n; i++) {
        f.moveTo((i / (n - 1) * 2 - 1) * spread, 0);
        f.dwell(6);
      }
    },
  },
  {
    // ビームの束を左右に振る
    id: 'sweep', name: 'スイープ', category: 'beam',
    hint: '5本のビームの束が左右に振れる',
    draw(f, t) {
      const n = 5, center = 0.75 * Math.sin(t * 2.2);
      for (let i = 0; i < n; i++) {
        f.moveTo(center + (i - (n - 1) / 2) * 0.06, 0);
        f.dwell(12);
      }
    },
  },
  {
    // 横に並べた点。ヘイズの中では1点ずつが光源から伸びるビームになり、扇状に見える
    id: 'fan', name: 'ファン', category: 'beam',
    hint: '横に並べた点。ヘイズの中では扇状に広がるビームになる',
    draw(f, t) {
      const n = 7;
      const spread = 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.9));
      for (let i = 0; i < n; i++) {
        f.moveTo((i / (n - 1) * 2 - 1) * spread, 0);
        f.dwell(12);
      }
    },
  },
  {
    // 並んだビームが1本ずつ順番に点く（照明のチェイスと同じ）。行って戻る
    id: 'chase', name: 'ビームチェイス', category: 'beam',
    hint: '横に並んだ9本のビームが、1本ずつ順番に点いていく（8分音符ごと。速さはBPM）',
    draw(f, _t, beat) {
      const n = 9, step = Math.floor(beat * 2), k = step % (2 * n - 2);
      const i = k < n ? k : 2 * n - 2 - k;
      f.moveTo((i / (n - 1) * 2 - 1) * 0.8, 0);
      f.dwell(40);
    },
  },
  {
    // たくさんの置き場所から、毎回ばらばらに数本だけ光らせる。時間から決めるので、書き出しても毎回同じ並び
    id: 'sparkle', name: 'スパークル', category: 'beam',
    hint: '客席の上に散らばった点のうち、ランダムに選んだ数本だけが一瞬ずつ光る（16分音符ごと。速さはBPM）',
    draw(f, _t, beat) {
      const slots = 48, lit = 5, step = Math.floor(beat * 4);
      for (let j = 0; j < lit; j++) {
        const s = Math.floor(rand(step * 7.13 + j * 1.71) * slots);
        // 横に広く、縦は少しだけ散らす
        f.moveTo((rand(s * 3.1) * 2 - 1) * 0.9, (rand(s * 5.7 + 1) * 2 - 1) * 0.25);
        f.dwell(10);
      }
    },
  },
  {
    // 並んだビームの高さが、波のように1本ずつずれて上下する。2拍で1往復
    id: 'beamwave', name: 'ビームウェーブ', category: 'beam',
    hint: '並んだ9本のビームの高さが、波のように1本ずつずれて上下する（2拍で1往復）',
    draw(f, _t, beat) {
      const n = 9;
      for (let i = 0; i < n; i++) {
        f.moveTo((i / (n - 1) * 2 - 1) * 0.8, 0.3 * Math.sin(Math.PI * beat - i * 0.7));
        f.dwell(10);
      }
    },
  },
  {
    // 光の膜を8分音符で点滅させる。点いている間だけ描き、消えている間は何も出さない
    id: 'strobe', name: 'ストロボ', category: 'beam',
    hint: '横一面の光の膜が、8分音符ごとにパッと光る（速さはBPM）',
    draw(f, _t, beat) {
      if ((beat * 2) % 1 > 0.35) return;
      f.curve((u, p) => { p.x = -0.9 + 1.8 * u; p.y = 0; });
    },
  },
  {
    // 小さな円は、ヘイズの中では中が空洞の円錐になる。4拍で開いて閉じ、8拍でゆっくり首を振る
    id: 'cone', name: 'コーン', category: 'beam',
    hint: '小さな円を描いて、ヘイズの中に中が空洞の円錐を作る。開いたり閉じたりしながら首を振る',
    draw(f, _t, beat) {
      const r = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(Math.PI * beat / 2));
      const cx = 0.15 * Math.cos(Math.PI * beat / 4), cy = 0.1 * Math.sin(Math.PI * beat / 4);
      f.curve((u, p) => { p.x = cx + r * Math.cos(u * TAU); p.y = cy + r * Math.sin(u * TAU); });
    },
  },
  {
    // 2枚の光の膜をX字に交差させる。4拍で開いて閉じ、全体がゆっくり回る
    id: 'cross', name: 'クロス', category: 'beam',
    hint: '2枚の光の膜をX字に交差させ、開いたり閉じたりしながら回す',
    draw(f, _t, beat) {
      const open = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(Math.PI * beat / 2)), rot = Math.PI * beat / 16;
      for (const a of [rot + open, rot - open]) {
        const x = 0.85 * Math.cos(a), y = 0.85 * Math.sin(a);
        f.moveTo(-x, -y);
        f.lineTo(x, y);
      }
    },
  },
  {
    // 並んだビームの奇数番と偶数番を、1拍ごとに交互に点ける
    id: 'oddeven', name: 'オッドイーブン', category: 'beam',
    hint: '並んだ8本のビームの奇数番と偶数番が、1拍ごとに交互に点く',
    draw(f, _t, beat) {
      const n = 8, odd = Math.floor(beat) % 2;
      for (let i = odd; i < n; i += 2) {
        f.moveTo((i / (n - 1) * 2 - 1) * 0.8, 0);
        f.dwell(14);
      }
    },
  },
  {
    // 扇のビームを8分音符の頭で短く光らせる（プラックやスネアに合わせる）
    id: 'beamflash', name: 'ビームフラッシュ', category: 'beam',
    hint: '7本の扇のビームが、8分音符の頭で短くパッと光る',
    draw(f, _t, beat) {
      if ((beat * 2) % 1 > 0.25) return;
      const n = 7;
      for (let i = 0; i < n; i++) {
        f.moveTo((i / (n - 1) * 2 - 1) * 0.7, 0);
        f.dwell(10);
      }
    },
  },
  {
    // 円の上に並べたビームのうち3本だけを点け、8分音符ごとに1つずつ回す。ヘイズの中ではビームが円錐の上を回る
    id: 'circlechase', name: 'サークルチェイス', category: 'beam',
    hint: '円の上に並んだ12本のうち3本だけが点き、8分音符ごとに回っていく',
    draw(f, _t, beat) {
      const n = 12, step = Math.floor(beat * 2);
      for (let k = 0; k < 3; k++) {
        const a = ((step + k * 4) % n) / n * Math.PI * 2;
        f.moveTo(0.45 * Math.cos(a), 0.45 * Math.sin(a));
        f.dwell(12);
      }
    },
  },
  {
    // 真ん中のビームから、1拍ごとに外側の左右1本ずつを足していく。広がるたびに色を変える（色の付け方が素材の色のとき）
    id: 'centerout', name: 'センターアウト', category: 'beam',
    hint: '真ん中のビームから、1拍ごとに外側へ1本ずつ広がる。カラーを「素材の色」にすると、広がるたびに色が変わる',
    draw(f, _t, beat) {
      const half = 4, step = Math.floor(beat) % (half + 2);
      for (let k = 0; k <= Math.min(step, half); k++) {
        f.color(HUES[k % HUES.length]);
        for (const side of k ? [-1, 1] : [1]) {
          f.moveTo(side * k / half * 0.8, 0);
          f.dwell(10);
        }
      }
      f.color(null);
    },
  },
  {
    // 扇のビームが上から下へ2拍かけて降りてくる（下がっていくフレーズに合わせる）
    id: 'downsweep', name: 'ダウンスイープ', category: 'beam',
    hint: '7本の扇のビームが、2拍かけて上から下へ降りてくる',
    draw(f, _t, beat) {
      const y = 0.35 - 0.6 * ((beat / 2) % 1), n = 7;
      for (let i = 0; i < n; i++) {
        f.moveTo((i / (n - 1) * 2 - 1) * 0.6, y);
        f.dwell(10);
      }
    },
  },
];

// 0〜1 の擬似乱数（同じ値からは同じ結果）
function rand(x: number) {
  const v = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// センターアウトで広がるたびに使う色（赤・黄・緑・水色・青・紫）
const HUES: readonly (readonly number[])[] = [
  [255, 40, 40], [255, 220, 0], [0, 255, 64], [0, 229, 255], [40, 80, 255], [255, 32, 192],
];
