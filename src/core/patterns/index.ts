import { register } from './registry';
import { lines } from './lines';
import { shapes } from './shapes';
import { beams } from './beams';
import { tests } from './tests';

for (const p of [...lines, ...shapes, ...beams, ...tests]) register(p);

// パターンを編集したらページを読み込み直さずに差し替える
if (import.meta.hot) import.meta.hot.accept();

export { getPattern, listPatterns } from './registry';
export type { Pattern, PatternCategory } from './registry';
