// ブラウザに保存（プライベートモードなどで使えなくても動くようにする）
export function loadLocal<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) as T : null;
  } catch {
    return null;
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても動作には影響しない
  }
}
