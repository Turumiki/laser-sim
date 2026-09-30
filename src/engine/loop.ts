// requestAnimationFrame の間隔で回す。止まっていた後に時間が飛ばないよう dt は抑える
export function startLoop(tick: (dt: number) => void) {
  let last = performance.now();
  let id = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tick(dt);
    id = requestAnimationFrame(frame);
  };
  id = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(id);
}

// 1フレームの処理時間（ms）の移動平均
export class FrameTimer {
  avg = 0;
  private t0 = 0;
  begin() {
    this.t0 = performance.now();
  }
  end() {
    this.avg = this.avg * 0.95 + (performance.now() - this.t0) * 0.05;
  }
}
