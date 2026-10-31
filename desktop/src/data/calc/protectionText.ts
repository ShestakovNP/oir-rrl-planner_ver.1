/** Text rows describing the protection scheme of one channel, shared by the screen and the PDF. */
import type { ChannelResult, LinkResult } from './link';
import { SCHEME_NAMES } from './protection';
import { downtime, fmt } from './format';

export interface ProtRow { t: string; s: string; v: string }

const relTxt = (x: number | null) => (x == null ? '—' : x > 3 ? '> 300%' : Math.round(x * 100) + '%');

export function protectionRows(r: LinkResult, c: ChannelResult): ProtRow[] {
  const d = c.div;
  if (!d) return [];
  const rows: ProtRow[] = [{ t: 'Схема резервирования', s: '', v: SCHEME_NAMES[d.scheme] }];
  if (d.scheme === 'hsb') rows.push({ t: 'Потери в делителях HSB', s: 'на двух концах, уже в уровне сигнала', v: fmt(d.hsbLoss, 1) + ' дБ' });
  const branch = (b: NonNullable<typeof d.a>, nm: string) =>
    rows.push({ t: `Вторая антенна на «${nm}»`, s: `разнос ${fmt(b.S, 1)} м, просвет ${relTxt(b.rel)} (в плохую погоду ${relTxt(b.relMin)}), разница уровней ${fmt(Math.abs(b.V), 1)} дБ`, v: `I = ${fmt(b.I, 1)}` });
  if (d.a) branch(d.a, r.siteA.name || 'A');
  if (d.b) branch(d.b, r.siteB.name || 'B');
  if (d.scheme === 'fd') rows.push({ t: 'Выигрыш от частотного разнесения', s: 'МСЭ-R P.530', v: `I = ${fmt(d.I, 1)}` });
  if (d.scheme === 'sd' || d.scheme === 'fd')
    rows.push({ t: 'Перерывы из-за многолучёвости', s: `без резервирования → с ним, при запасе ${c.ref ? c.ref.name : ''}`, v: `${downtime(d.mpPlain)} → ${downtime(d.mpDiv)}` });
  return rows;
}
