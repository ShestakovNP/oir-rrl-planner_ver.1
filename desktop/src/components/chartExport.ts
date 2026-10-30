/** Saves an on-screen SVG chart as a PNG or JPEG picture with a title and a legend. */
import { saveFile } from '../storage/files';

const PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility'
];

export interface LegendItem { label: string; color: string; line?: boolean }

/** Copies the computed styles of every element into inline attributes so the SVG renders on its own. */
function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  const style = PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
  dst.setAttribute('style', style);
  for (let i = 0; i < src.children.length; i++) inlineStyles(src.children[i], dst.children[i]);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось подготовить изображение графика.'));
    img.src = url;
  });
}

export async function exportChart(
  svg: SVGSVGElement,
  opts: { format: 'png' | 'jpeg'; fileName: string; title: string; subtitle?: string; legend: LegendItem[] }
): Promise<string | null> {
  const W = svg.viewBox.baseVal?.width || svg.clientWidth, H = svg.viewBox.baseVal?.height || svg.clientHeight;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.querySelectorAll('.cursor').forEach((n) => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(W));
  clone.setAttribute('height', String(H));
  const xml = new XMLSerializer().serializeToString(clone);
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml));

  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => root.getPropertyValue(name).trim() || fb;
  const bg = v('--panel', '#ffffff'), ink = v('--ink', '#1b1f24'), muted = v('--muted', '#6b7480');
  const font = getComputedStyle(svg).fontFamily || 'sans-serif';

  const scale = 2, pad = 16, head = opts.subtitle ? 52 : 34;
  const ctx0 = document.createElement('canvas').getContext('2d')!;
  ctx0.font = `12px ${font}`;
  // legend layout: wrap into rows
  const rows: { item: LegendItem; x: number; row: number }[] = [];
  let x = pad, row = 0;
  for (const item of opts.legend) {
    const w = 18 + ctx0.measureText(item.label).width + 16;
    if (x + w > W + pad && x > pad) { x = pad; row++; }
    rows.push({ item, x, row });
    x += w;
  }
  const legendH = opts.legend.length ? (row + 1) * 18 + 8 : 0;
  const CW = W + pad * 2, CH = head + H + legendH + pad;

  const canvas = document.createElement('canvas');
  canvas.width = CW * scale; canvas.height = CH * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = ink; ctx.font = `700 15px ${font}`; ctx.textBaseline = 'alphabetic';
  ctx.fillText(opts.title, pad, 24);
  if (opts.subtitle) { ctx.fillStyle = muted; ctx.font = `12px ${font}`; ctx.fillText(opts.subtitle, pad, 42); }
  ctx.drawImage(img, pad, head, W, H);
  ctx.font = `12px ${font}`; ctx.textBaseline = 'middle';
  rows.forEach(({ item, x: lx, row: r }) => {
    const y = head + H + 10 + r * 18;
    ctx.fillStyle = item.color;
    if (item.line) ctx.fillRect(lx, y - 1, 13, 2.5);
    else ctx.fillRect(lx, y - 4, 13, 8);
    ctx.fillStyle = muted;
    ctx.fillText(item.label, lx + 18, y);
  });

  const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.93));
  if (!blob) throw new Error('Не удалось сохранить изображение.');
  const data = new Uint8Array(await blob.arrayBuffer());
  const ext = opts.format === 'png' ? 'png' : 'jpg';
  return saveFile(`${opts.fileName}.${ext}`, data, [{ name: opts.format === 'png' ? 'Изображение PNG' : 'Изображение JPEG', extensions: opts.format === 'png' ? ['png'] : ['jpg', 'jpeg'] }]);
}
