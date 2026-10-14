import type { Data3DTexture, Texture, Vector2 } from 'three';
import { FIELD_PERIOD, FIELD_VOXEL } from './smoke-field';

// ヘイズの中のビームの見え方。光の膜・ビームの線（beams.ts）と、クッキーの描き方（volume.ts）で使う

// 膜だけを載せる層。普段の描画（RenderPass）には入らない。VRで使う層（1・2）とは別にする
export const HAZE_LAYER = 5;

// ヘイズの濃さのむら。ノイズを少し歪ませて渦のように流す。
// 濃い所ほどビームが明るく見える（smoke=0 なら一様なヘイズ）
export const SMOKE_GLSL = `
  uniform float uTime;
  uniform float uSmoke;
  uniform float uGrain;
  uniform float uExt;
  // 1: 膜の厚みの中を3か所測る / 0: 1か所だけ（軽い）
  uniform float uThick;
  // ビームの見え方の物理:
  // ・ヘイズで散乱した分だけビームは減っていく（ベール・ランベルト則）
  // ・ヘイズの粒は光を前向きに散乱しやすいので、光源の方を向いて見るほど明るい（ヘニエイ・グリーンスタイン）
  // w: 光源から見た位置
  float airlight(vec3 w, vec3 viewDir) {
    float r = length(w);
    vec3 beamDir = w / max(r, 1e-4);
    float c = dot(beamDir, -viewDir);
    const float g = 0.4;
    float phase = pow((1.0 + g * g) / (1.0 + g * g - 2.0 * g * c), 1.5);
    return exp(-uExt * r) * phase;
  }
  // 光の膜は遠いほど広がって薄くなる（距離に反比例。4mで1）
  float spread(vec3 w) {
    return min(3.0, 4.0 / max(length(w), 0.1));
  }
  uniform highp sampler3D uNoise;
  // 前もって作った3Dノイズを読む（1周期 = ノイズの格子8つぶん）
  float tex(vec3 p) {
    return texture(uNoise, p * 0.125).r;
  }
  // 煙の糸の模様（smoke-field.ts で焼いたもの）。時刻の違う2枚をつないで、形をゆっくり変える
  uniform highp sampler3D uField0;
  uniform highp sampler3D uField1;
  uniform float uFieldMix;
  vec2 field(vec3 q, float lod) {
    return mix(textureLod(uField0, q, lod).rg, textureLod(uField1, q, lod).rg, uFieldMix);
  }
  // ヘイズの濃さ（平均1）。大きくゆるいむら・流れに沿った筋に加えて、
  // 煙が渦を巻いてできる細い糸（光の膜の上では、渦巻く暗い筋に見える）を重ねる。
  // 空調や送風で横に流され、熱で上の方に少し溜まる。uTime は流れの速さを掛けた時間
  // blur: どれだけの幅（m）でならして読むか。光の膜の厚みのぶん、模様はならされて見える
  float smoke1(vec3 w, float blur) {
    vec3 flow = vec3(uTime * 0.25, uTime * 0.02, -uTime * 0.15);
    vec3 pl = (w + flow) * uGrain * 0.15;
    vec3 pm = (w + flow * 1.6) * uGrain * vec3(0.35, 1.2, 0.35);
    pm += 0.6 * (tex(pm * 0.35 + vec3(0.0, 0.0, uTime * 0.12)) - 0.5);
    float large = tex(pl);
    float mid = tex(pm);
    // 糸の模様は周期 ${FIELD_PERIOD} で焼いてあるので、その周期で割って読む。細かい糸は同じ模様を2倍の細かさで読む
    vec3 q = (w + flow * 1.4) * uGrain * 2.2 / ${FIELD_PERIOD.toFixed(1)};
    // ならす幅が焼いた模様の何マスぶんか。その分ぼかした段を読む。
    // そのままでは遠くの膜で糸が消えて染みのようになるので、ぼかしは控えめにして2段までにする
    float lod = clamp(log2(max(1.0, blur * uGrain * 2.2 / ${FIELD_VOXEL.toFixed(6)})) - 2.0, 0.0, 2.0);
    vec2 f = field(q, lod);
    float c2 = field(q * 2.0 + 0.37, lod + 1.0).r;
    // ノイズの値は0.5のまわりに集まるので、振れ幅を大きめに取る
    float d = 1.0 + 1.4 * (large - 0.5) + 1.6 * (mid - 0.5);
    // ノイズがちょうど真ん中になる所を、煙の糸として取り出す（糸の所は煙が薄く、暗く見える）。
    // 糸の太さは場所によって変える（太く柔らかい筋から細い筋まで）。細かい糸も少し重ねる
    float w1 = mix(0.03, 0.16, smoothstep(0.35, 0.65, f.g));
    float t1 = smoothstep(0.0, w1, abs(f.r - 0.5));
    float t2 = smoothstep(0.0, 0.05, abs(c2 - 0.5));
    d *= mix(0.3, 1.1, t1) * mix(0.7, 1.04, t2);
    // 上の方ほど少し濃い（10m上で1割ほど）
    return max(0.0, d * (1.0 + 0.01 * w.y));
  }
  // 光の膜には厚みがある（遠いほどビームが広がって厚い）。視線に沿って厚みの中を数か所測って平均する
  // w: 空間での位置、r: 光源からの距離
  float smoke(vec3 w, vec3 viewDir, float r) {
    float thick = 0.03 + 0.05 * r;
    // 厚みの中を何か所も測る代わりに、厚みのぶんぼかした模様を1回読む
    return mix(1.0, smoke1(w, uThick > 0.5 ? thick : 0.0), uSmoke);
  }
`;

export interface HazeUniforms {
  uTime: { value: number };
  uSmoke: { value: number };
  uGrain: { value: number };
  // ヘイズの減衰係数（1mあたり）
  uExt: { value: number };
  uThick: { value: number };
  uNoise: { value: Data3DTexture };
  uField0: { value: Texture | null };
  uField1: { value: Texture | null };
  uFieldMix: { value: number };
  // ローリングシャッター: x = 読み出し時間（露光時間を1とする。0で無効）, y = 1 なら残像（指数）
  uRoll: { value: Vector2 };
  // 描画先の大きさ（px）。どの行を撮っているかを出すのに使う
  uRes: { value: Vector2 };
}

// カメラは上の行ほど早く撮り終わる（ローリングシャッター）。その行が撮っている時間帯に、この光が入るか。
// 古さが負（時刻のないベクター表示）なら常に写る
export const SHUTTER_GLSL = `
  uniform vec2 uRoll;
  uniform vec2 uRes;
  varying float vAge;
  float shutter() {
    if (uRoll.x <= 0.0 || vAge < 0.0) return 1.0;
    float row = 1.0 - gl_FragCoord.y / uRes.y;
    float a = vAge - (1.0 - row) * uRoll.x;
    if (a < 0.0) return 0.0;
    return uRoll.y > 0.5 ? exp(-a) : step(a, 1.0);
  }
`;
