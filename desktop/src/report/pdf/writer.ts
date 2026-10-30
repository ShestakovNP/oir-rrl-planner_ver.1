/**
 * Minimal PDF 1.4 writer: A4 pages, embedded TrueType fonts (Identity-H with
 * ToUnicode, so text stays selectable and searchable), lines, rectangles,
 * polygons and circles. No external libraries and no network.
 */
import { PDF_FONTS, type PdfFontData } from './fontdata';

export type FontKey = 'R' | 'B';
export interface TextOpts { size?: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' }
export interface ShapeOpts { fill?: string; stroke?: string; w?: number; dash?: number[]; alpha?: number }

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();
const rgb = (c: string) => {
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3)).join(' ');
};

export class PdfDoc {
  readonly W = 595.28;
  readonly H = 841.89;
  private fonts: Record<FontKey, PdfFontData> = { R: PDF_FONTS.R, B: PDF_FONTS.B };
  private used: Record<FontKey, Set<number>> = { R: new Set(), B: new Set() };
  private pages: { ops: string[] }[] = [];
  private cur: { ops: string[] } | null = null;
  private alphas = new Set<number>();

  get pageCount() { return this.pages.length; }
  addPage() { this.cur = { ops: [] }; this.pages.push(this.cur); return this.pages.length; }
  setPage(i: number) { this.cur = this.pages[i]; }
  private op(s: string) { if (!this.cur) this.addPage(); this.cur!.ops.push(s); }

  private gid(fk: FontKey, ch: string): number {
    const F = this.fonts[fk];
    const g = F.cmap[String(ch.codePointAt(0))];
    return g == null ? F.cmap['63'] ?? 0 : g;
  }
  width(str: string, size: number, fk: FontKey = 'R'): number {
    const F = this.fonts[fk];
    let w = 0;
    for (const ch of str) w += F.w[String(this.gid(fk, ch))] ?? 500;
    return (w * size) / 1000;
  }
  text(x: number, y: number, str: string, o: TextOpts = {}) {
    const fk: FontKey = o.bold ? 'B' : 'R';
    const size = o.size ?? 10;
    let hex = '';
    for (const ch of String(str)) {
      const g = this.gid(fk, ch);
      this.used[fk].add(g);
      hex += g.toString(16).padStart(4, '0');
    }
    let tx = x;
    if (o.align === 'right') tx = x - this.width(str, size, fk);
    else if (o.align === 'center') tx = x - this.width(str, size, fk) / 2;
    this.op(`BT /F${fk} ${f2(size)} Tf ${rgb(o.color ?? '#1a2129')} rg ${f2(tx)} ${f2(this.H - y)} Td <${hex}> Tj ET`);
  }
  wrap(str: string, maxW: number, size: number, fk: FontKey = 'R'): string[] {
    const out: string[] = [];
    String(str).split('\n').forEach((par) => {
      const words = par.split(/\s+/).filter(Boolean);
      let line = '';
      words.forEach((w) => {
        const t = line ? line + ' ' + w : w;
        if (this.width(t, size, fk) <= maxW || !line) line = t;
        else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }
  private style(o: ShapeOpts) {
    let s = '';
    if (o.alpha != null) { const a = Math.round(o.alpha * 100); this.alphas.add(a); s += `/GS${a} gs `; }
    if (o.fill) s += rgb(o.fill) + ' rg ';
    if (o.stroke) s += rgb(o.stroke) + ' RG ';
    s += `${f2(o.w ?? 0.5)} w `;
    if (o.dash) s += `[${o.dash.join(' ')}] 0 d `;
    return s;
  }
  private paint(o: ShapeOpts, closed: boolean) {
    if (o.fill && o.stroke) return closed ? 'b' : 'B';
    if (o.fill) return 'f';
    return 'S';
  }
  line(x1: number, y1: number, x2: number, y2: number, o: ShapeOpts = {}) {
    this.op(`q ${this.style({ ...o, stroke: o.stroke ?? '#c9d1d9', fill: undefined })}${f2(x1)} ${f2(this.H - y1)} m ${f2(x2)} ${f2(this.H - y2)} l S Q`);
  }
  rect(x: number, y: number, w: number, h: number, o: ShapeOpts = {}) {
    this.op(`q ${this.style(o)}${f2(x)} ${f2(this.H - y - h)} ${f2(w)} ${f2(h)} re ${this.paint(o, false)} Q`);
  }
  poly(pts: [number, number][], o: ShapeOpts = {}) {
    const path = pts.map((p, i) => `${f2(p[0])} ${f2(this.H - p[1])} ${i ? 'l' : 'm'}`).join(' ');
    this.op(`q ${this.style(o)}${path}${o.fill ? ' h' : ''} ${this.paint(o, true)} Q`);
  }
  circle(cx: number, cy: number, r: number, o: ShapeOpts = {}) {
    const k = 0.5523 * r, y = this.H - cy;
    this.op(`q ${this.style(o)}${f2(cx + r)} ${f2(y)} m ${f2(cx + r)} ${f2(y + k)} ${f2(cx + k)} ${f2(y + r)} ${f2(cx)} ${f2(y + r)} c ${f2(cx - k)} ${f2(y + r)} ${f2(cx - r)} ${f2(y + k)} ${f2(cx - r)} ${f2(y)} c ${f2(cx - r)} ${f2(y - k)} ${f2(cx - k)} ${f2(y - r)} ${f2(cx)} ${f2(y - r)} c ${f2(cx + k)} ${f2(y - r)} ${f2(cx + r)} ${f2(y - k)} ${f2(cx + r)} ${f2(y)} c ${this.paint(o, true)} Q`);
  }

  build(meta: { title?: string; author?: string } = {}): Uint8Array {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let len = 0;
    const offs: number[] = [];
    const push = (s: string | Uint8Array) => { const b = typeof s === 'string' ? enc.encode(s) : s; chunks.push(b); len += b.length; };
    type Obj = string | { dict: string; stream: Uint8Array };
    const objs: (Obj | null)[] = [];
    const obj = () => { objs.push(null); return objs.length; };
    const set = (n: number, body: Obj) => { objs[n - 1] = body; };
    const b64 = (s: string) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const pdfStr = (s: string) => {
      let h = 'FEFF';
      for (const ch of s) {
        const c = ch.codePointAt(0)!;
        if (c > 0xffff) { const v = c - 0x10000; h += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 1023)).toString(16).padStart(4, '0'); }
        else h += c.toString(16).padStart(4, '0');
      }
      return `<${h}>`;
    };
    const catalog = obj(), pagesN = obj();
    const fontRefs: Record<FontKey, number> = { R: 0, B: 0 };
    (['R', 'B'] as FontKey[]).forEach((fk) => {
      const F = this.fonts[fk];
      const ttf = b64(F.ttf);
      const ff = obj(); set(ff, { dict: `<< /Length ${ttf.length} /Length1 ${ttf.length} >>`, stream: ttf });
      const fd = obj(); set(fd, `<< /Type /FontDescriptor /FontName /${F.name} /Flags 32 /FontBBox [${F.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${F.asc} /Descent ${F.desc} /CapHeight ${F.cap} /StemV ${fk === 'B' ? 120 : 80} /FontFile2 ${ff} 0 R >>`);
      const gids = [...this.used[fk]].sort((a, b) => a - b);
      if (!gids.length) gids.push(0);
      const wArr = gids.map((g) => `${g} [${F.w[String(g)] ?? 500}]`).join(' ');
      const cid = obj(); set(cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${F.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /W [${wArr}] /CIDToGIDMap /Identity >>`);
      const rev: Record<number, number> = {};
      Object.entries(F.cmap).forEach(([u, g]) => { if (rev[g] == null) rev[g] = +u; });
      const bf = gids.filter((g) => rev[g] != null).map((g) => `<${g.toString(16).padStart(4, '0')}> <${rev[g].toString(16).padStart(4, '0')}>`);
      let cm = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n';
      for (let i = 0; i < bf.length; i += 100) { const part = bf.slice(i, i + 100); cm += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`; }
      cm += 'endcmap CMapName currentdict /CMap defineresource pop end end';
      const cmb = enc.encode(cm);
      const tu = obj(); set(tu, { dict: `<< /Length ${cmb.length} >>`, stream: cmb });
      const t0 = obj(); set(t0, `<< /Type /Font /Subtype /Type0 /BaseFont /${F.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
      fontRefs[fk] = t0;
    });
    const gs = [...this.alphas].map((a) => `/GS${a} << /Type /ExtGState /ca ${(a / 100).toFixed(2)} /CA ${(a / 100).toFixed(2)} >>`).join(' ');
    const kids: number[] = [];
    this.pages.forEach((p) => {
      const content = enc.encode(p.ops.join('\n'));
      const c = obj(); set(c, { dict: `<< /Length ${content.length} >>`, stream: content });
      const pg = obj(); set(pg, `<< /Type /Page /Parent ${pagesN} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /FR ${fontRefs.R} 0 R /FB ${fontRefs.B} 0 R >> /ExtGState << ${gs} >> >> /Contents ${c} 0 R >>`);
      kids.push(pg);
    });
    set(pagesN, `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    set(catalog, `<< /Type /Catalog /Pages ${pagesN} 0 R >>`);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const info = obj(); set(info, `<< /Title ${pdfStr(meta.title ?? '')} /Author ${pdfStr(meta.author ?? '')} /Producer ${pdfStr('ОИР RRL Planner')} /CreationDate (D:${stamp}) >>`);
    push('%PDF-1.4\n%');
    push(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    objs.forEach((o, i) => {
      offs[i] = len;
      push(`${i + 1} 0 obj\n`);
      if (typeof o === 'string') push(o + '\n');
      else if (o) { push(o.dict + '\nstream\n'); push(o.stream); push('\nendstream\n'); }
      push('endobj\n');
    });
    const xref = len;
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offs.forEach((o) => { x += String(o).padStart(10, '0') + ' 00000 n \n'; });
    push(x + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out = new Uint8Array(len);
    let p = 0;
    chunks.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }
}
