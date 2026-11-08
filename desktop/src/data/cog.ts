/**
 * Minimal reader of Cloud-Optimized GeoTIFFs over HTTP range requests: reads single pixels of
 * the full-resolution image without downloading the whole file. Supports classic TIFF and
 * BigTIFF, both byte orders, tiles or strips, no compression, DEFLATE and LZW, horizontal
 * predictor, 8/16/32-bit integer and 32/64-bit float samples (first band only).
 * Pure: the caller supplies the range fetcher, so it is tested with local files.
 */
import pako from 'pako';

/** Bytes [start, end) of the file; null when the file does not exist (HTTP 404). */
export type RangeFetch = (start: number, end: number) => Promise<Uint8Array | null>;

export interface CogInfo {
  width: number;
  height: number;
  /** Georeference: x = x0 + col·sx, y = y0 − row·sy (pixel corners). */
  x0: number;
  y0: number;
  sx: number;
  sy: number;
  nodata: number | null;
}

interface Arr { offset: number; count: number; size: number; inline?: number[] }

export class CogReader {
  info!: CogInfo;
  private le = true;
  private big = false;
  private tw = 0; private th = 0; private across = 0;
  private bits = 8; private fmt = 1; private comp = 1; private pred = 1; private spp = 1; private planar = 1;
  private offsets!: Arr; private counts!: Arr;
  private tileCache = new Map<number, Promise<ArrayLike<number> | null>>();
  private entryCache = new Map<number, [number, number]>();

  private constructor(private fetchRange: RangeFetch) {}

  /** null when the file does not exist. */
  static async open(fetchRange: RangeFetch): Promise<CogReader | null> {
    const r = new CogReader(fetchRange);
    return (await r.init()) ? r : null;
  }

  private async init(): Promise<boolean> {
    let head = await this.fetchRange(0, 65536);
    if (!head) return false;
    const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    let d = dv(head);
    const bo = String.fromCharCode(head[0], head[1]);
    if (bo !== 'II' && bo !== 'MM') throw new Error('Файл данных повреждён (не TIFF).');
    this.le = bo === 'II';
    const magic = d.getUint16(2, this.le);
    this.big = magic === 43;
    if (magic !== 42 && magic !== 43) throw new Error('Файл данных повреждён (не TIFF).');
    const ifd = this.big ? Number(d.getBigUint64(8, this.le)) : d.getUint32(4, this.le);
    const entrySize = this.big ? 20 : 12, cntSize = this.big ? 8 : 2;
    // make sure the whole first IFD is in the buffer
    const need = async (end: number) => {
      if (end > head!.length) { const more = await this.fetchRange(0, end + 4096); if (!more) throw new Error('Файл данных оборвался.'); head = more; d = dv(head); }
    };
    await need(ifd + cntSize);
    const n = this.big ? Number(d.getBigUint64(ifd, this.le)) : d.getUint16(ifd, this.le);
    await need(ifd + cntSize + n * entrySize);
    const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
    const tags = new Map<number, Arr & { type: number }>();
    for (let i = 0; i < n; i++) {
      const p = ifd + cntSize + i * entrySize;
      const tag = d.getUint16(p, this.le), type = d.getUint16(p + 2, this.le);
      const count = this.big ? Number(d.getBigUint64(p + 4, this.le)) : d.getUint32(p + 4, this.le);
      const size = typeSize[type] ?? 1;
      const valPos = p + (this.big ? 12 : 8);
      const fits = size * count <= (this.big ? 8 : 4);
      const offset = fits ? valPos : this.big ? Number(d.getBigUint64(valPos, this.le)) : d.getUint32(valPos, this.le);
      tags.set(tag, { offset, count, size, type });
    }
    const read = async (tag: number, max = 64): Promise<number[] | null> => {
      const t = tags.get(tag);
      if (!t) return null;
      const c = Math.min(t.count, max);
      await need(t.offset + c * t.size);
      const out: number[] = [];
      for (let i = 0; i < c; i++) out.push(this.num(d, t.offset + i * t.size, t.type));
      return out;
    };
    const one = async (tag: number, def: number) => (await read(tag, 1))?.[0] ?? def;
    const width = await one(256, 0), height = await one(257, 0);
    this.bits = await one(258, 8); this.comp = await one(259, 1); this.pred = await one(317, 1);
    this.spp = await one(277, 1); this.planar = await one(284, 1); this.fmt = await one(339, 1);
    if (tags.has(322)) {
      this.tw = await one(322, 256); this.th = await one(323, 256);
      this.offsets = tags.get(324)!; this.counts = tags.get(325)!;
    } else {
      this.tw = width; this.th = await one(278, height);
      this.offsets = tags.get(273)!; this.counts = tags.get(279)!;
    }
    if (!this.offsets || !this.counts) throw new Error('Файл данных без таблицы тайлов.');
    this.across = Math.ceil(width / this.tw);
    if (![1, 5, 8, 32946].includes(this.comp)) throw new Error(`Сжатие ${this.comp} в файле данных не поддерживается.`);
    // small arrays (strips of a test file) are kept from the header
    for (const a of [this.offsets, this.counts] as (Arr & { type: number })[]) {
      if (a.count * a.size <= head.length - a.offset && a.offset + a.count * a.size <= head.length) {
        a.inline = []; for (let i = 0; i < a.count; i++) a.inline.push(this.num(d, a.offset + i * a.size, a.type));
      }
    }
    const scale = await read(33550, 3), tie = await read(33922, 6);
    let nodata: number | null = null;
    const nd = tags.get(42113);
    if (nd) { await need(nd.offset + nd.count); const s = new TextDecoder().decode(head.subarray(nd.offset, nd.offset + nd.count)).replace(/\0/g, '').trim(); nodata = s ? Number(s) : null; }
    this.info = {
      width, height,
      sx: scale?.[0] ?? 1, sy: scale?.[1] ?? 1,
      x0: (tie?.[3] ?? 0) - (tie?.[0] ?? 0) * (scale?.[0] ?? 1),
      y0: (tie?.[4] ?? 0) + (tie?.[1] ?? 0) * (scale?.[1] ?? 1),
      nodata: Number.isFinite(nodata as number) ? nodata : null
    };
    return true;
  }

  private num(d: DataView, p: number, type: number): number {
    switch (type) {
      case 1: case 2: case 7: return d.getUint8(p);
      case 6: return d.getInt8(p);
      case 3: return d.getUint16(p, this.le);
      case 8: return d.getInt16(p, this.le);
      case 4: return d.getUint32(p, this.le);
      case 9: return d.getInt32(p, this.le);
      case 11: return d.getFloat32(p, this.le);
      case 12: return d.getFloat64(p, this.le);
      case 16: return Number(d.getBigUint64(p, this.le));
      case 17: return Number(d.getBigInt64(p, this.le));
      case 5: return d.getUint32(p, this.le) / (d.getUint32(p + 4, this.le) || 1);
      default: return d.getUint8(p);
    }
  }

  /** Offset and byte count of tile k (fetched in batches for neighbouring tiles). */
  private async entries(ks: number[]): Promise<void> {
    const miss = ks.filter((k) => !this.entryCache.has(k));
    if (!miss.length) return;
    const o = this.offsets as Arr & { type: number }, c = this.counts as Arr & { type: number };
    if (o.inline && c.inline) { miss.forEach((k) => this.entryCache.set(k, [o.inline![k], c.inline![k]])); return; }
    miss.sort((a, b) => a - b);
    // group indices that are close together into one request per array
    const groups: number[][] = [];
    for (const k of miss) { const g = groups[groups.length - 1]; if (g && k - g[g.length - 1] < 512) g.push(k); else groups.push([k]); }
    await Promise.all(groups.map(async (g) => {
      const lo = g[0], hi = g[g.length - 1];
      const [bo, bc] = await Promise.all([
        this.fetchRange(o.offset + lo * o.size, o.offset + (hi + 1) * o.size),
        this.fetchRange(c.offset + lo * c.size, c.offset + (hi + 1) * c.size)
      ]);
      if (!bo || !bc) throw new Error('Файл данных оборвался.');
      const dvo = new DataView(bo.buffer, bo.byteOffset, bo.byteLength), dvc = new DataView(bc.buffer, bc.byteOffset, bc.byteLength);
      for (const k of g) this.entryCache.set(k, [this.num(dvo, (k - lo) * o.size, o.type), this.num(dvc, (k - lo) * c.size, c.type)]);
    }));
  }

  private decode(raw: Uint8Array): ArrayLike<number> {
    let b: Uint8Array;
    if (this.comp === 1) b = raw;
    else if (this.comp === 8 || this.comp === 32946) b = pako.inflate(raw);
    else b = lzwDecode(raw);
    const bytes = this.bits / 8, n = this.tw * this.th * this.spp;
    let le = this.le;
    if (this.pred === 3) { b = floatPredictor(b, this.tw * this.spp, this.th, bytes, this.spp); le = true; }
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out = this.fmt === 3 ? new Float64Array(n) : new Float64Array(n);
    const avail = Math.min(n, Math.floor(b.byteLength / bytes));
    for (let i = 0; i < avail; i++) {
      const p = i * bytes;
      out[i] = this.fmt === 3 ? (bytes === 4 ? dv.getFloat32(p, le) : dv.getFloat64(p, le))
        : bytes === 1 ? (this.fmt === 2 ? dv.getInt8(p) : dv.getUint8(p))
        : bytes === 2 ? (this.fmt === 2 ? dv.getInt16(p, le) : dv.getUint16(p, le))
        : this.fmt === 2 ? dv.getInt32(p, le) : dv.getUint32(p, le);
    }
    if (this.pred === 2 && this.fmt !== 3) {
      const mod = 2 ** this.bits, rowLen = this.tw * this.spp;
      for (let r = 0; r < this.th; r++) for (let i = this.spp; i < rowLen; i++) {
        const k = r * rowLen + i; let v = out[k] + out[k - this.spp];
        v = ((v % mod) + mod) % mod; if (this.fmt === 2 && v >= mod / 2) v -= mod; out[k] = v;
      }
    }
    return out;
  }

  private tile(k: number): Promise<ArrayLike<number> | null> {
    let p = this.tileCache.get(k);
    if (!p) {
      p = (async () => {
        const [off, cnt] = this.entryCache.get(k) ?? [0, 0];
        if (!cnt) return null; // sparse COG: empty tile
        const raw = await this.fetchRange(off, off + cnt);
        if (!raw) throw new Error('Файл данных оборвался.');
        return this.decode(raw);
      })();
      this.tileCache.set(k, p);
      if (this.tileCache.size > 400) this.tileCache.delete(this.tileCache.keys().next().value as number);
    }
    return p;
  }

  /** Pixel values (first band) at [col, row]; null outside the image, in empty tiles or nodata. */
  async pixels(px: [number, number][], onProgress?: (done: number, total: number) => void): Promise<(number | null)[]> {
    const { width, height, nodata } = this.info;
    const key = (c: number, r: number) => Math.floor(r / this.th) * this.across + Math.floor(c / this.tw);
    const ks = [...new Set(px.filter(([c, r]) => c >= 0 && r >= 0 && c < width && r < height).map(([c, r]) => key(Math.floor(c), Math.floor(r))))];
    await this.entries(ks);
    let done = 0;
    const tiles = new Map<number, ArrayLike<number> | null>();
    // a few downloads at a time
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, ks.length) }, async () => {
      while (next < ks.length) { const k = ks[next++]; tiles.set(k, await this.tile(k)); onProgress?.(++done, ks.length); }
    }));
    const stride = this.planar === 1 ? this.spp : 1;
    return px.map(([cf, rf]) => {
      const c = Math.floor(cf), r = Math.floor(rf);
      if (c < 0 || r < 0 || c >= width || r >= height) return null;
      const t = tiles.get(key(c, r));
      if (!t) return null;
      const v = t[((r % this.th) * this.tw + (c % this.tw)) * stride];
      return v === undefined || (nodata != null && v === nodata) ? null : v;
    });
  }
}

/** Floating-point predictor (TIFF predictor 3): byte differencing, then byte planes → little-endian samples. */
export function floatPredictor(src: Uint8Array, perRow: number, rows: number, bytes: number, spp: number): Uint8Array {
  const out = new Uint8Array(perRow * rows * bytes);
  const rowLen = perRow * bytes;
  for (let r = 0; r < rows; r++) {
    const buf = src.slice(r * rowLen, (r + 1) * rowLen);
    for (let i = spp; i < rowLen; i++) buf[i] = (buf[i] + buf[i - spp]) & 255;
    for (let j = 0; j < perRow; j++) for (let k = 0; k < bytes; k++) out[r * rowLen + j * bytes + k] = buf[(bytes - k - 1) * perRow + j];
  }
  return out;
}

/** TIFF LZW (MSB first, early change). */
export function lzwDecode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let dict: number[][] = [];
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push([i]); dict.push([], []); };
  reset();
  let bitPos = 0, width = 9, prev: number[] | null = null;
  const totalBits = input.length * 8;
  const readCode = () => {
    if (bitPos + width > totalBits) return 257;
    let v = 0;
    for (let i = 0; i < width; i++) { const b = bitPos + i; v = (v << 1) | ((input[b >> 3] >> (7 - (b & 7))) & 1); }
    bitPos += width;
    return v;
  };
  for (;;) {
    const code = readCode();
    if (code === 257) break;
    if (code === 256) { reset(); width = 9; prev = null; continue; }
    let entry: number[];
    if (code < dict.length && dict[code].length) entry = dict[code];
    else if (prev) entry = prev.concat(prev[0]);
    else break;
    for (const v of entry) out.push(v);
    if (prev) dict.push(prev.concat(entry[0]));
    prev = entry;
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return Uint8Array.from(out);
}
