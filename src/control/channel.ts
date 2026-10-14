// このページを別のチャンネルで開き直す（設定・プレビュー・シーケンスはどれも1つのチャンネルにつながっているため）
export function switchChannel(next: string) {
  const q = new URLSearchParams(location.search);
  if (next === 'default') q.delete('ch'); else q.set('ch', next);
  location.search = q.toString();
}
