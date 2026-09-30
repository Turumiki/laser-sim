import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  build: {
    // OBSのブラウザソースは少し古いChromiumなので余裕を持たせる
    target: ['chrome100', 'safari15'],
    rollupOptions: {
      input: {
        index: page('./index.html'),
        output: page('./output.html'),
      },
    },
  },
});
