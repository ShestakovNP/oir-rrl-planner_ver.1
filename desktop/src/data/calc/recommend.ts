/** Plain-language recommendations derived from a LinkResult. Texts use **bold** markers. */
import { geometry, interpolate, type LinkResult, type Level } from './link';
import { rainModel } from './physics';
import { fresnelWater } from './water';
import { downtime, fmt, ghz, pct } from './format';

export interface Rec {
  level: Level;
  title: string;
  text: string;
}

const order: Record<Level, number> = { bad: 0, warn: 1, ok: 2, info: 3 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildRecommendations(r: LinkResult): Rec[] {
  const recs: Rec[] = [];
  const { path: P, k, kMin, geom: G, geomMin: Gmin, siteA, siteB } = r;
  const nameA = siteA.name || 'A', nameB = siteB.name || 'B';
  const lowest = r.channels.reduce((a, b) => (b.fGHz < a.fGHz ? b : a));
  const fRef = lowest.fGHz;

  /* clearance */
  const clearOk = (dA: number, dB: number) => {
    const Q = { ...P, HA: P.HA + dA, HB: P.HB + dB };
    const c1 = geometry(Q, k, fRef).crit, c2 = geometry(Q, kMin, fRef).crit;
    return (!c1 || c1.rel >= 0.577) && (!c2 || c2.rel >= 0);
  };
  const fNote = r.multi ? ` Просвет проверен по нижней частоте (${ghz(lowest.ch.freqMHz)}): у неё зона Френеля шире.` : '';
  if (!clearOk(0, 0)) {
    let both: number | null = null, onlyA: number | null = null, onlyB: number | null = null;
    for (let h = 1; h <= 80; h++) {
      if (both == null && clearOk(h, h)) both = h;
      if (onlyA == null && clearOk(h, 0)) onlyA = h;
      if (onlyB == null && clearOk(0, h)) onlyB = h;
      if (both != null && onlyA != null && onlyB != null) break;
    }
    const opts: string[] = [];
    if (both != null) opts.push(`обе антенны на **${both} м** (до ${fmt(P.hA + both, 0)} и ${fmt(P.hB + both, 0)} м)`);
    if (onlyA != null) opts.push(`только антенну на «${nameA}» на **${onlyA} м**`);
    if (onlyB != null) opts.push(`только антенну на «${nameB}» на **${onlyB} м**`);
    const why: string[] = [];
    if (G.crit && G.crit.rel < 0.577) why.push(`Сейчас просвет ${Math.round(G.crit.rel * 100)}% зоны Френеля, а для открытой трассы нужно от 58%`);
    if (Gmin.crit && Gmin.crit.rel < 0) why.push(`в плохую погоду (k = ${fmt(kMin, 2)}) препятствие перекрывает луч`);
    recs.push({
      level: G.crit && G.crit.rel < 0 ? 'bad' : 'warn',
      title: 'Поднимите антенны',
      text: `${why.join(', и ')}. ${opts.length ? 'Достаточно поднять ' + opts.join(', или ') + '.' : 'Подъём даже на 80 м не помогает: нужна другая трасса или промежуточная станция.'}${fNote}`
    });
  } else {
    let low = 0;
    for (let h = 1; h < Math.min(P.hA, P.hB) - 3; h++) {
      if (clearOk(-h, -h)) low = h;
      else break;
    }
    recs.push({
      level: 'ok',
      title: 'Просвета хватает',
      text: 'Трасса открыта и в обычную, и в плохую погоду.' + (low >= 3 ? ` Есть запас по высоте: обе антенны можно опустить на **${low} м**. Это упрощает монтаж и снижает стоимость места на мачте.` : '') + fNote
    });
  }
  if (G.crit) {
    const q = interpolate(P.pts, G.crit.d), cc = q.c;
    if (cc > 0)
      recs.push(q.t === 'b'
        ? { level: 'info', title: 'Узкое место — здание', text: `На ${fmt(G.crit.d, 1)} км здание высотой ${fmt(cc, 0)} м над землёй. Высота взята из OpenStreetMap или типовая — уточните её на месте и учтите возможную надстройку: заложите 3–5 м запаса по высоте антенн.` }
        : { level: 'info', title: q.t === 'f' ? 'Узкое место — лес' : 'Узкое место — лес или застройка', text: `На ${fmt(G.crit.d, 1)} км препятствие высотой ${fmt(cc, 0)} м над землёй. Деревья прирастают на 0,3–0,5 м в год, поэтому проверьте высоту при обследовании трассы и заложите 3–5 м запаса по высоте антенн.` });
  }

  /* two channels on one antenna */
  if (r.multi) {
    if (r.coChannel && r.samePol)
      recs.push({ level: 'bad', title: 'Стволы глушат друг друга', text: 'Оба ствола на одной частоте и в одной поляризации. Разнесите их по поляризациям (один горизонтальный, другой вертикальный) или по частоте.' });
    else if (r.coChannel && r.xpd == null)
      recs.push({ level: 'warn', title: 'Укажите развязку поляризаций антенн', text: 'Оба ствола работают на одной частоте и отличаются только поляризацией. Друг от друга их отделяет развязка поляризаций антенны (XPD), поэтому без неё помеха между стволами не учитывается и запас получается завышенным. Возьмите XPD из паспорта антенны и введите во вкладке «Исходные данные».' });
    else if (r.coChannel) {
      const md = Math.max(0, ...r.channels.flatMap((c) => c.modes.map((m) => m.deg)));
      recs.push({ level: 'warn', title: 'Стволы на одной частоте в разных поляризациях', text: `Друг от друга их отделяет только развязка поляризаций антенны, ${fmt(r.xpd ?? NaN, 0)} дБ. Из-за этого порог приёмника ухудшается до ${fmt(md, 1)} дБ (больше всего на высоких модуляциях); это уже учтено в запасе. В замирания и дождь развязка падает, поэтому включите на ППУ подавление кросс-поляризационной помехи (XPIC).` });
    } else
      recs.push({ level: 'ok', title: 'Стволы не мешают друг другу', text: `Стволы в разных частотных диапазонах${r.samePol ? '' : ' и на разных поляризациях'}. Антенна должна быть рассчитана на оба диапазона (${r.channels.map((c) => ghz(c.ch.freqMHz)).join(' и ')}).${r.samePol ? ' Обычно стволы разводят по разным поляризациям: так легче их развязать.' : ''}` });
  }

  /* per channel */
  const gain = (need: number) =>
    need <= 2 ? 'Хватит небольшого улучшения: например, антенны на ступень больше на одном конце или меньших потерь в тракте.'
      : need <= 6 ? 'Хватит антенны вдвое большего диаметра на одном конце (≈ +6 дБ) или более мощного передатчика.'
      : need <= 12 ? 'Нужны антенны вдвое большего диаметра на обоих концах (≈ +12 дБ).'
      : 'Только антеннами не добрать: нужен пространственно разнесённый приём (две антенны на мачте), более короткий пролёт или более низкая частота.';
  let mpSaid = false, rainSaid = false;
  r.channels.forEach((c) => {
    const p0 = r.multi ? c.tag + ': ' : '';
    if (c.best)
      recs.push({
        level: 'ok', title: `${p0}гарантированная скорость — ${c.best.name}, ${fmt(c.best.rateMbps, 1)} Мбит/с`,
        text: `Для нормы нужен запас не меньше **${fmt(c.marginRequired, 1)} дБ**, на этом режиме он ${fmt(c.best.margin, 1)} дБ.` +
          (c.top && c.top.rateMbps > c.best.rateMbps ? ` Включите адаптивную модуляцию (ACM): базовый режим ${c.best.name}, максимальный ${c.top.name}. В хорошую погоду ствол даст до ${fmt(c.top.rateMbps, 1)} Мбит/с и при замираниях будет снижать скорость, а не обрываться. Средняя скорость за год с ACM ≈ **${fmt(c.avgRate, 1)} Мбит/с**.` : '')
      });
    if (c.next) {
      const need = c.marginRequired - c.next.margin;
      recs.push({
        level: c.best ? 'info' : 'bad',
        title: c.best ? `${p0}как получить ${c.next.name}, ${fmt(c.next.rateMbps, 1)} Мбит/с` : `${p0}норма не выполняется ни на одной скорости`,
        text: `${c.best ? 'Не' : 'Даже на ' + c.next.name + ' не'} хватает **${fmt(need, 1)} дБ** запаса. ${gain(need)}`
      });
      if (!mpSaid && c.next.mpYear > c.next.rainYear * 3 && c.fGHz <= 13) {
        mpSaid = true;
        recs.push({ level: 'info', title: 'Перерывы в основном из-за многолучёвости', text: 'Дождь на этих частотах почти не мешает. Сильнее всего помогает пространственно разнесённый приём: вторая антенна на том же объекте на 10–15 м ниже.' + (c.div?.scheme === 'sd' ? '' : ' Выберите схему «1+1 SD» в «Исходных данных» — программа посчитает выигрыш.') });
      }
    }
    const bm = c.best || c.ref;
    if (!rainSaid && bm && bm.margin > 0 && bm.rainYear > bm.mpYear && c.fGHz >= 10) {
      rainSaid = true;
      const alt = rainModel(c.fGHz, P.D, r.climate.rainR001, c.pol === 'H' ? 'V' : 'H');
      const otherU = bm.mpYear + alt.pFor(bm.margin);
      recs.push({
        level: 'info', title: `${p0}перерывы в основном из-за дождя`,
        text: `На ${ghz(c.ch.freqMHz)} почти все перерывы дают ливни: ослабление в ливень на этом пролёте ${fmt(c.rain.A001, 1)} дБ.` +
          (c.pol === 'H' && r.method !== 'gost' ? ` На вертикальной поляризации перерывов было бы ≈ ${downtime(otherU)} в год вместо ${downtime(bm.u)}: в дождь она ослабевает меньше.` : '') +
          ' Интенсивность дождя сильнее всего влияет на результат, поэтому сверьте её с климатической зоной района.'
      });
    }
    const subBad = c.modes.filter((m) => m.margin > 0 && !m.subOk).map((m) => m.name);
    if (subBad.length)
      recs.push({ level: 'warn', title: `${p0}риск в плохую погоду`, text: `При сильной субрефракции (k = ${fmt(kMin, 2)}) препятствие отнимет ${fmt(c.diffMin - c.diff, 1)} дБ, и режимы ${subBad.join(', ')} могут пропадать на часы. Это не входит в расчёт неготовности. Помогает подъём антенн.` });
    if (c.best && c.best.margin > 45)
      recs.push({ level: 'info', title: `${p0}сигнала с большим избытком`, text: `Запас ${fmt(c.best.margin, 0)} дБ — больше, чем нужно. Снизьте мощность передатчика или включите ATPC: так меньше помех соседним линиям.` });
    ([['A', c.ch.gainA, c.gAcalc, r.path, nameA], ['B', c.ch.gainB, c.gBcalc, r.path, nameB]] as const).forEach(([, gin, gc, , nm]) => {
      if (gin != null && Number.isFinite(gc) && Math.abs(gin - gc) > 4)
        recs.push({ level: 'warn', title: `${p0}проверьте коэффициент усиления антенны на «${nm}»`, text: `Антенна такого диаметра на ${ghz(c.ch.freqMHz)} обычно имеет КУ около **${fmt(gc, 1)} дБ**, а указано ${fmt(gin, 1)} дБ. Сверьтесь с паспортом: ошибка в КУ напрямую меняет запас.` });
    });
  });

  /* interference from other links at the same objects */
  r.channels.forEach((c) => {
    if (!c.intf || !c.ref) return;
    const p0 = r.multi ? c.tag + ': ' : '';
    const worst = c.intf.list.reduce((a, b) => (b.I > a.I ? b : a));
    const ci = c.ref.prx - worst.I;
    const lvl = c.ref.deg >= c.ref.margin && c.ref.margin > 0 ? 'bad' : c.ref.deg > 1 ? 'warn' : 'info';
    const nm = worst.at === 'A' ? nameA : nameB;
    const tips: string[] = ['разнести частоты (другой частотный канал)'];
    if (worst.samePol) tips.push('перевести один из пролётов на другую поляризацию');
    tips.push(worst.theta < 20 ? 'увеличить угол между направлениями пролётов (сейчас он мал)' : 'взять антенну большего диаметра или более высокого класса ETSI (ниже боковые лепестки)');
    recs.push({
      level: lvl, title: `${p0}помеха от пролёта «${worst.name}» на той же частоте`,
      text: `На объекте «${nm}» есть пролёт «${worst.name}» на перекрывающейся частоте (${fmt(worst.fMHz, 0)} МГц). Его передатчик на дальнем конце светит прямо на «${nm}», а наша антенна видит его под углом **${fmt(worst.theta, 1)}°** к своему лучу. Помеха ${fmt(worst.I, 1)} дБм, сигнал/помеха **${fmt(ci, 1)} дБ**${c.ref.deg > 0.05 ? `, порог ухудшается на ${fmt(c.ref.deg, 1)} дБ на ${c.ref.name} (уже учтено в запасе)` : ' — запас почти не страдает'}.` +
        (!worst.samePol && worst.xpd === 0 ? ' Поляризации разные, но развязка поляризаций антенны (XPD) здесь не учтена — оценка с запасом; реальная помеха будет слабее на величину XPD (обычно 25–30 дБ по паспорту).' : '') +
        (lvl !== 'info' ? ` Что помогает: ${tips.join('; ')}.` : '') +
        (c.intf.list.length > 1 ? ` Всего мешающих стволов: ${c.intf.list.length}, их мощности сложены.` : '') +
        ' Расчёт по эталонной диаграмме МСЭ-R F.699; точнее — по диаграмме (RPE) из паспорта антенны. Влияние передатчиков, стоящих на той же мачте рядом, не считается.'
    });
  });

  /* protection scheme */
  const dc = r.channels.find((c) => c.div);
  if (dc && dc.div) {
    const d = dc.div;
    const p0 = r.multi ? dc.tag + ': ' : '';
    if (d.scheme === 'hsb')
      recs.push({ level: 'info', title: 'Горячий резерв 1+1 HSB', text: `Защищает от отказа ППУ: при неисправности работает резервное. От замираний и дождя не спасает, а делители отнимают **${fmt(d.hsbLoss, 1)} дБ** запаса (уже учтено). Если перерывы из-за многолучёвости — рассмотрите пространственно разнесённый приём (1+1 SD).` });
    if (d.scheme === 'sd' || d.scheme === 'fd') {
      const G = r.method === 'gost';
      const span = (a: number, b: number) => (G ? `${pct(a)} → ${pct(b)} худшего месяца` : `${downtime(a)} → ${downtime(b)} в год`);
      const nm = d.scheme === 'sd' ? 'Пространственно разнесённый приём (1+1 SD)' : 'Частотное разнесение (1+1 FD)';
      const weak = d.I < 2;
      recs.push({
        level: weak ? 'info' : 'ok', title: `${p0}${nm}`,
        text: weak
          ? `По методике ${G ? 'ГОСТ Р 53363-2009' : 'МСЭ-R P.530'} выигрыш на этом пролёте небольшой (I = ${fmt(d.I, 1)}): многолучёвость здесь и так слабая или запас мал. Многолучёвые замирания ≈ ${span(d.mpPlain, d.mpDiv)}.${d.scheme === 'sd' ? ' Увеличьте разнос антенн по высоте — выигрыш растёт.' : ''}`
          : `Многолучёвые замирания сокращаются примерно в **${fmt(d.I, 0)} раз**: ≈ ${span(d.mpPlain, d.mpDiv)}. От дождя резервирование не спасает — он ослабляет обе ветви одновременно.`
      });
      if (d.scheme === 'fd') recs.push({ level: 'info', title: 'Нужна вторая частота', text: 'Частотное разнесение занимает два частотных канала на одной трассе — согласуйте вторую частоту при оформлении разрешения.' });
      if (d.validity.length) recs.push({ level: 'info', title: 'Оценка выигрыша — за пределами проверенного диапазона', text: `Формула P.530 проверена не для всех условий этого пролёта: ${d.validity.join('; ')}. Результат — ориентир.` });
    }
    if (d.scheme === 'sd') {
      ([['A', d.a, nameA, P.hA], ['B', d.b, nameB, P.hB]] as const).forEach(([, b, nm, hMain]) => {
        if (!b) return;
        if ((b.rel != null && b.rel < 0.577) || (b.relMin != null && b.relMin < 0))
          recs.push({ level: b.relMin != null && b.relMin < 0 ? 'warn' : 'info', title: `Мало просвета у второй антенны на «${nm}»`, text: `При разносе ${fmt(b.S, 1)} м от основной (${fmt(hMain, 0)} м) просвет второй антенны ${b.rel == null ? '—' : Math.round(b.rel * 100) + '%'} зоны Френеля${b.relMin != null && b.relMin < 0 ? ', а в плохую погоду препятствие перекрывает её луч' : ''}. Она будет принимать слабее основной и выигрыш упадёт. Уменьшите разнос или поднимите обе антенны.` });
        if (Math.abs(b.V) > 6)
          recs.push({ level: 'info', title: `Уровни на двух антеннах «${nm}» сильно различаются`, text: `Разница ${fmt(Math.abs(b.V), 1)} дБ (антенны разного размера, разные фидеры или просвет). Выигрыш от разнесения уменьшается на эту величину — лучше одинаковые антенны и фидеры.` });
      });
    }
  }

  /* water on the path: reflection, interference, refraction */
  if (r.water > 0) {
    const withR = r.channels.filter((c) => c.refl && !c.refl.blocked);
    const share = Math.round(r.water * 100);
    if (withR.length) {
      const c = withR.reduce((a, b) => (b.refl!.worst > a.refl!.worst ? b : a));
      const w = c.refl!;
      const p0 = r.multi ? c.tag + ': ' : '';
      const margin = c.ref ? c.ref.margin : NaN;
      const level = Number.isFinite(margin) && w.worst >= margin ? 'bad' : w.worst >= 6 ? 'warn' : 'info';
      if (w.rho < 0.1) {
        const why: string[] = [];
        if (w.discA + w.discB < -6) why.push(`отражённый луч приходит под углом и антенны ослабляют его на ${fmt(-(w.discA + w.discB), 0)} дБ`);
        if (w.roughness < 0.5) why.push('на этой частоте волны на воде рассеивают отражение');
        if (w.divergence < 0.5) why.push('кривизна Земли рассеивает отражённую волну');
        recs.push({ level: 'ok', title: `${p0}отражение от воды не мешает`, text: `Луч отражается от водной глади на ${fmt(w.d, 2)} км от «${nameA}», но отражённая волна слабая — ${Math.max(1, Math.round(w.rho * 100))}% от прямой${why.length ? ': ' + why.join(', ') : ''}. Замирания от интерференции не больше ${fmt(Math.max(0, w.worst), 1)} дБ.` });
      } else {
      const now = w.loss > 0.05
        ? `Сейчас (k = ${fmt(k, 2)}) волны частично гасят друг друга: −${fmt(w.loss, 1)} дБ, это уже учтено в уровне сигнала.`
        : `Сейчас (k = ${fmt(k, 2)}) волны складываются и сигнал выше на ${fmt(-w.loss, 1)} дБ, но этот выигрыш в расчёт не взят: он пропадает при смене погоды.`;
      const other = c.pol === 'H' ? 'V' : 'H';
      const gO = Math.hypot(...fresnelWater(c.fGHz, w.psi / 1000, other));
      const polTip = other === 'V' && gO < w.gamma - 0.02 ? ` Вертикальная поляризация отражается от воды слабее (|Γ| ${fmt(gO, 2)} против ${fmt(w.gamma, 2)}).` : '';
      recs.push({
        level, title: `${p0}отражение от воды`,
        text: `Луч отражается от водной глади на **${fmt(w.d, 2)} км** от «${nameA}» (вода на ${fmt(w.from, 2)}–${fmt(w.to, 2)} км), угол скольжения ${fmt(w.psi, 1)} мрад. Отражённая волна приходит с амплитудой ≈ ${Math.round(w.rho * 100)}% от прямой и интерферирует с ней. ${now} ` +
          `При изменении рефракции (k от ${fmt(Math.min(kMin, k), 2)} до 3) возможны замирания до **${fmt(w.worst, 1)} дБ**${Number.isFinite(margin) ? ` при запасе ${fmt(margin, 1)} дБ` : ''}. ` +
          `Что помогает: сделать антенны заметно разными по высоте, чтобы точка отражения ушла на берег, или закрыть её берегом, лесом, строением; пространственно разнесённый приём — вторая антенна на **${fmt(w.spacingB, 1)} м** выше или ниже на «${nameB}» (на «${nameA}» — ${fmt(w.spacingA, 1)} м); антенны с более узким лучом.${polTip}`
      });
      }
    } else if (r.channels.some((c) => c.refl?.blocked)) {
      recs.push({ level: 'ok', title: 'Отражение от воды закрыто', text: `Точка отражения попадает на воду, но её не видно с одной из антенн: луч к ней перекрывает рельеф или препятствия. Интерференции с отражённой волной не будет.` });
    } else {
      recs.push({ level: 'info', title: 'Вода на трассе', text: `Над водой ${share}% трассы, но точка зеркального отражения приходится на сушу, где отражение рассеивается. Если уровень воды сезонно меняется (паводок, водохранилище), перепроверьте расчёт.` });
    }
    if (r.water >= 0.1)
      recs.push({
        level: 'info', title: 'Рефракция над водой',
        text: `Над водой (${share}% трассы) чаще бывают приземные волноводы и сверхрефракция: в штиль, летом, утром и вечером, когда воздух над водой холоднее. Луч то прижимается к воде, то уходит вверх, поэтому многолучёвые замирания сильнее, чем на сухопутной трассе. Заложите дополнительные 5–10 дБ запаса или пространственно разнесённый приём; ${r.method === 'gost' ? 'если трасса у моря, выберите тип трассы «Приморская» во вкладке «Исходные данные» (ГОСТ Р 53363-2009 учитывает это коэффициентом C).' : 'для оценки можно задать градиент рефракции dN1 более отрицательным (−500…−600) во вкладке «Исходные данные».'}`
      });
  }

  if (r.geo) {
    const lv = r.channels.filter((c) => c.ref).map((c) => `**${fmt(c.ref!.prx, 0)} дБм**${r.multi ? ' в ' + c.tag : ''}`).join(', ');
    recs.push({
      level: 'info', title: 'Как навести антенны',
      text: `На «${nameA}»: азимут **${fmt(r.geo.az1, 1)}°**, угол места ${fmt(r.tiltA, 2)}°. На «${nameB}»: азимут **${fmt(r.geo.az2, 1)}°**, угол места ${fmt(r.tiltB, 2)}°. Сначала наведите грубо по компасу или ориентирам, затем точно по уровню сигнала на приёмнике${lv ? ': ожидается около ' + lv : ''}. Если уровень ниже на 3 дБ и больше, антенна, скорее всего, поймала боковой лепесток.`
    });
  }
  r.warnings.forEach((w) => recs.push({ level: 'warn', title: 'Проверьте исходные данные', text: w }));
  return recs.map((x) => ({ ...x, title: cap(x.title) })).sort((a, b) => order[a.level] - order[b.level]);
}

