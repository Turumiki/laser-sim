import { download, stamp } from './download';

const TYPES = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

// 画面に出ているキャンバスをそのまま録画する（リアルタイム）
export class Recorder {
  private rec: MediaRecorder | null = null;
  private timer = 0;
  private t0 = 0;
  private canvas: HTMLCanvasElement;
  onChange?: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  get recording() {
    return this.rec !== null;
  }

  get elapsed() {
    return this.rec ? (performance.now() - this.t0) / 1000 : 0;
  }

  start(seconds: number, name: string, fps: number) {
    const mime = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) throw new Error('このブラウザは録画に対応していません');
    const stream = this.canvas.captureStream(fps);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 40e6 });
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      download(new Blob(chunks, { type: mime.split(';')[0] }), `${name}_${stamp()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
      this.rec = null;
      this.onChange?.();
    };
    rec.start(500);
    this.rec = rec;
    this.t0 = performance.now();
    if (seconds > 0) this.timer = window.setTimeout(() => this.stop(), seconds * 1000);
    this.onChange?.();
  }

  stop() {
    clearTimeout(this.timer);
    if (this.rec?.state === 'recording') this.rec.stop();
  }
}
