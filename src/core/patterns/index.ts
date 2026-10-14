import { register } from './registry.ts';
import { lines } from './lines.ts';
import { shapes } from './shapes.ts';
import { beams } from './beams.ts';
import { tests } from './tests.ts';

for (const p of [...lines, ...shapes, ...beams, ...tests]) register(p);

// パターンを編集したらページを読み込み直さずに差し替える
if (import.meta.hot) import.meta.hot.accept();

export { getPattern, listPatterns } from './registry.ts';
export type { Pattern, PatternCategory } from './registry.ts';
