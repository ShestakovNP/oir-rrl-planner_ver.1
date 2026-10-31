/** H vs V comparison per channel and the best split of two channels over polarizations. */
import type { Pol } from '../types';
import { calcChannel, type ChannelContext, type ChannelResult, type LinkResult, type ModeResult } from './link';
import { downtime, fmt, ghz, minutesPerYear } from './format';

export interface PolOption {
  pol: Pol;
  current: boolean;
  winner: boolean;
  rainA001: number;
  /** Result on the reference mode of the current configuration. */
  ref: ModeResult | null;
  best: ModeResult | null;
}

export interface PolChannel {
  n: 1 | 2;
  tag: string;
  freq: string;
  refName: string | null;
  options: [PolOption, PolOption];
  winner: Pol | null;
  /** Text with **bold** markers. */
  verdict: string;
}

export interface PolarizationResult {
  channels: PolChannel[];
  pair: string | null;
}

export function comparePolarization(r: LinkResult, ctx: ChannelContext): PolarizationResult {
  const sums = new Map<string, { rate: number; down: number }>();
  const perChannel = r.channels.map((c) => {
    const run = (pol: Pol) => {
      const x: ChannelResult = calcChannel(ctx, c.ch, c.n, pol);
      const refName = c.ref;
      const ref = refName ? x.modes.find((m) => m.name === refName.name && m.rateMbps === refName.rateMbps) || null : null;
      return { pol, x, ref, best: x.best, A: x.rain.A001 };
    };
    const H = run('H'), V = run('V');
    const dU = H.ref && V.ref ? H.ref.u - V.ref.u : 0;
    const dRate = (V.best ? V.best.rateMbps : 0) - (H.best ? H.best.rateMbps : 0);
    const minDiff = Math.abs(minutesPerYear(dU));
    let winner: Pol | null = null;
    if (dRate > 0) winner = 'V';
    else if (dRate < 0) winner = 'H';
    else if (minDiff >= 1) winner = dU > 0 ? 'V' : 'H';
    const freq = ghz(c.ch.freqMHz);
    let verdict: string;
    if (!c.ref) verdict = 'Добавьте режимы модуляции, чтобы сравнить поляризации.';
    else if (c.fGHz < 10)
      verdict = `На ${freq} дождь почти не ослабляет сигнал, разница между H и V ${minDiff < 1 ? 'меньше минуты' : 'около ' + downtime(Math.abs(dU))} в год. Выбирайте поляризацию по частотному плану и помехам от соседних линий.`;
    else if (!winner) verdict = 'Разница меньше минуты в год, поляризацию можно выбирать по частотному плану.';
    else {
      const W = winner === 'V' ? V : H, L = winner === 'V' ? H : V;
      const other = winner === 'V' ? 'горизонтальной' : 'вертикальной';
      verdict = `**${winner === 'V' ? 'Вертикальная' : 'Горизонтальная'} поляризация стабильнее.** ` +
        (dRate !== 0 ? `На ней в норму укладывается ${W.best!.name}, ${fmt(W.best!.rateMbps, 1)} Мбит/с, ${L.best ? `а на ${other} только ${L.best.name}, ${fmt(L.best.rateMbps, 1)} Мбит/с` : `а на ${other} не укладывается ни один режим`}. ` : '') +
        (W.ref && L.ref && W.ref.margin > 0 ? `На ${c.ref.name} перерывов в год ≈ ${downtime(W.ref.u)} вместо ${downtime(L.ref.u)}, в ливень сигнал слабеет на ${fmt(L.A - W.A, 1)} дБ меньше.` : '') +
        (c.pol === winner ? ' Сейчас выбрана именно она.' : ' Сейчас выбрана другая — если частотный план позволяет, смените.');
    }
    const opt = (S: typeof H): PolOption => ({ pol: S.pol, current: S.pol === c.pol, winner: winner === S.pol, rainA001: S.A, ref: S.ref, best: S.best });
    ([H, V] as const).forEach((S) => sums.set(`${c.n}${S.pol}`, { rate: S.best ? S.best.rateMbps : 0, down: S.ref && S.ref.margin > 0 ? S.ref.u : 100 }));
    const pc: PolChannel = { n: c.n, tag: c.tag, freq, refName: c.ref ? c.ref.name : null, options: [opt(H), opt(V)], winner, verdict };
    return pc;
  });

  let pair: string | null = null;
  if (r.multi && !(r.coChannel && r.samePol)) {
    const [a, b] = r.channels;
    const tot = (pa: Pol, pb: Pol) => {
      const A = sums.get(`${a.n}${pa}`)!, B = sums.get(`${b.n}${pb}`)!;
      return { rate: Math.round((A.rate + B.rate) * 10) / 10, down: A.down + B.down };
    };
    const flip = (p: Pol): Pol => (p === 'H' ? 'V' : 'H');
    const cur = tot(a.pol, b.pol), alt = tot(flip(a.pol), flip(b.pol));
    const hi = a.fGHz >= b.fGHz ? a : b;
    const hiF = ghz(hi.ch.freqMHz);
    const dMin = minutesPerYear(cur.down - alt.down);
    const altBetter = alt.rate > cur.rate || (alt.rate === cur.rate && dMin >= 1);
    const curBetter = cur.rate > alt.rate || (alt.rate === cur.rate && dMin <= -1);
    let t = a.pol === b.pol ? 'Сейчас оба ствола на одной поляризации. Обычно их разносят: так проще развязать стволы на общей антенне. ' : '';
    if (curBetter)
      t += `**Раскладка правильная:** ${a.tag} — ${a.pol}, ${b.tag} — ${b.pol}.` +
        (alt.rate < cur.rate ? ` Если поменять местами, скорость в норме упадёт с ${fmt(cur.rate, 1)} до ${fmt(alt.rate, 1)} Мбит/с.` : ` Если поменять местами, перерывов станет больше примерно на ${downtime(alt.down - cur.down)} в год.`);
    else if (altBetter)
      t += `**Лучше поменять:** ${a.tag} на ${flip(a.pol)}, ${b.tag} на ${flip(b.pol)}. ` +
        (alt.rate > cur.rate ? `Скорость в норме вырастет с ${fmt(cur.rate, 1)} до ${fmt(alt.rate, 1)} Мбит/с. ` : '') +
        (dMin >= 1 ? `Перерывов станет меньше примерно на ${downtime(cur.down - alt.down)} в год. ` : '') +
        `Вертикаль стоит отдавать более высокому диапазону (${hiF}): его сильнее гасит дождь.`;
    else
      t += `**Обе раскладки дают почти одинаковый результат:** ${fmt(cur.rate, 1)} Мбит/с в норме, разница в перерывах меньше минуты в год. ` +
        (hi.fGHz >= 10 ? `При прочих равных вертикаль отдают более высокому диапазону (${hiF}), потому что его сильнее гасит дождь${hi.pol === 'V' ? ' — так сейчас и сделано' : ''}.` : 'На этих частотах дождь влияет слабо, раскладку можно выбирать по частотному плану.');
    pair = t;
  }
  return { channels: perChannel, pair };
}
