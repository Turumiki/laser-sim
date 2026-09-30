import type { Settings } from '../core/params';
import type { Show } from '../core/show';
import { download, stamp } from './download';
import { exportVideo } from './exporter';

export interface ExportJob {
  settings: Readonly<Settings>;
  seconds: number;
  name: string;
  show?: Show;
}

// ボタンを「書き出し」ボタンにする。書き出し中にもう一度押すと中止
export function attachExport(button: HTMLButtonElement, job: () => ExportJob) {
  const label = button.textContent ?? '書き出し';
  const title = button.title;
  let abort: AbortController | null = null;

  button.addEventListener('click', async () => {
    if (abort) { abort.abort(); return; }
    abort = new AbortController();
    const j = job();
    let failed = '';
    try {
      button.classList.add('on');
      const blob = await exportVideo(j.settings, {
        seconds: j.seconds,
        fps: Number(j.settings.fps),
        show: j.show,
        signal: abort.signal,
        onProgress: r => { button.textContent = `中止 ${Math.round(r * 100)}%`; },
      });
      download(blob, `${j.name}_${stamp()}.mp4`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') failed = (e as Error).message;
    } finally {
      abort = null;
      button.classList.remove('on');
      button.textContent = failed ? '書き出し失敗' : label;
      button.title = failed || title;
      if (failed) setTimeout(() => { button.textContent = label; }, 4000);
    }
  });
}
