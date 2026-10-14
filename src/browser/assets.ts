import { setAssetFetcher, type Asset } from '../core/assets';

// 素材の中身はサーバーに置いてあるので、使うときに取ってくる
export function useServerAssets() {
  setAssetFetcher(id =>
    fetch(`/api/assets/${encodeURIComponent(id)}`)
      .then(r => (r.ok ? r.json() as Promise<Asset> : Promise.reject(new Error(String(r.status))))));
}
