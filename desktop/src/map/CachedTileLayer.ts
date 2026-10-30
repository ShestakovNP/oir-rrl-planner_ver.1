/** Leaflet tile layer that loads tiles through the app's cache and network layer. */
import * as L from 'leaflet';
import { tileSrc } from './tileCache';

const OFFLINE_TILE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9edf1"/><path d="M0 0h256v256" fill="none" stroke="#d5dbe1"/><text x="128" y="132" font-family="sans-serif" font-size="12" fill="#8a96a3" text-anchor="middle">нет карты: нет сети</text></svg>'
  );

export class CachedTileLayer extends L.TileLayer {
  constructor(url: string, options: L.TileLayerOptions) {
    super(url, { ...options, errorTileUrl: OFFLINE_TILE, crossOrigin: false });
    this.on('tileunload', (e: L.TileEvent) => {
      const img = e.tile as HTMLImageElement;
      if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    });
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const img = document.createElement('img');
    img.alt = '';
    img.setAttribute('role', 'presentation');
    img.decoding = 'async';
    const url = this.getTileUrl(coords);
    tileSrc(url)
      .then((src) => {
        img.onload = () => done(undefined, img);
        img.onerror = () => done(new Error('tile'), img);
        img.src = src;
      })
      .catch(() => done(new Error('tile'), img));
    return img;
  }
}
