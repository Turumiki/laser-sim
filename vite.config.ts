import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig(({ mode }) => {
  // 手元の環境だけで通したいホスト名は .env.local の DEV_ALLOWED_HOSTS にカンマ区切りで書く
  const extraHosts = (loadEnv(mode, page('.'), '').DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  return {
    server: {
      // 開発サーバーは知らないホスト名を弾くので、同じネットワークの .local の名前は通す
      allowedHosts: ['.local', ...extraHosts],
    },
    build: {
      // OBSのブラウザソースは少し古いChromiumなので余裕を持たせる
      target: ['chrome100', 'safari15'],
      rollupOptions: {
        input: {
          index: page('./index.html'),
          output: page('./output.html'),
          viewer: page('./viewer.html'),
        },
      },
    },
  };
});
