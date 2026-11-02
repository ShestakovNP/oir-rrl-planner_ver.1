/**
 * «Первые шаги»: a guide shown on first launch. Steps complete by themselves as the user works
 * (project → two objects → link → the link tabs); the current target on screen is outlined.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Icon } from './ui';

type LinkTab = 'result' | 'input' | 'profile' | 'detail';
const TAB_INFO: { k: LinkTab; title: string; text: string }[] = [
  { k: 'input', title: 'Исходные данные', text: 'Высоты подвеса и антенны на обоих концах, ППУ и режимы модуляции, частоты и поляризации стволов, климат и требуемая надёжность.' },
  { k: 'profile', title: 'Профиль', text: 'Рельеф SRTM, здания, лес и вода с карты; ручная правка точек; сохранение графика в PNG или JPEG.' },
  { k: 'detail', title: 'Итог', text: 'Результаты по каждому режиму, сравнение поляризаций и весь расчёт по шагам. Отчёт PDF — кнопка «PDF» вверху карточки пролёта.' },
  { k: 'result', title: 'Подробно', text: 'Вердикт простыми словами, запас по сигналу, рекомендации (высоты антенн, модуляция, поляризация), профиль трассы и азимуты для наведения.' }
];

interface Props {
  linkOpen: boolean;
  sidebarTab: 'sites' | 'links' | 'equipment';
  onClose(): void;
  onNewProject(): void;
  onAddSiteMap(): void;
  onAddSiteCoords(): void;
  onAddLink(): void;
  onOpenLink(): void;
}

/** Outline around the element marked with data-guide=<key>; follows it while the layout changes. */
function Spotlight({ target }: { target: string | null }) {
  const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!target) { setR(null); return; }
    let raf = 0, last = '';
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
      const b = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
      const key = b ? `${b.x}|${b.y}|${b.width}|${b.height}` : '';
      if (key !== last) { last = key; setR(b); }
      raf = window.setTimeout(tick, 250) as unknown as number;
    };
    tick();
    return () => window.clearTimeout(raf);
  }, [target]);
  if (!r) return null;
  return <div className="guide-spot" style={{ left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }} aria-hidden="true" />;
}

export function Guide(p: Props) {
  const { projects, project, sites, links } = useStore();
  const [seen, setSeen] = useState<Set<LinkTab>>(new Set());
  const [curTab, setCurTab] = useState<LinkTab | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent).detail as LinkTab;
      setCurTab(t);
      setSeen((s) => (s.has(t) ? s : new Set(s).add(t)));
    };
    window.addEventListener('oir:link-tab', on);
    return () => window.removeEventListener('oir:link-tab', on);
  }, []);

  const done1 = projects.length > 0 && !!project;
  const done2 = done1 && sites.length >= 2;
  const done3 = done2 && links.length >= 1;
  const nextTab = TAB_INFO.find((t) => !seen.has(t.k));
  const done4 = done3 && !nextTab;
  const step = !done1 ? 1 : !done2 ? 2 : !done3 ? 3 : !done4 ? 4 : 5;

  let target: string | null = null;
  if (step === 1) target = 'project';
  else if (step === 2) target = p.sidebarTab === 'sites' ? 'add-site' : 'tab-sites';
  else if (step === 3) target = document.querySelector('[data-guide="site-link"]') ? 'site-link' : p.sidebarTab === 'links' ? 'add-link' : 'tab-links';
  else if (step === 4) target = p.linkOpen && nextTab ? 'ltab-' + nextTab.k : p.sidebarTab === 'links' ? null : 'tab-links';
  else target = p.linkOpen ? 'pdf' : null;

  const items = [
    { n: 1, title: 'Создайте проект', done: done1 },
    { n: 2, title: 'Добавьте два объекта', done: done2 },
    { n: 3, title: 'Соедините их пролётом', done: done3 },
    { n: 4, title: 'Посмотрите вкладки пролёта', done: done4 }
  ];

  return (
    <>
      <Spotlight target={target} />
      <section className="guide floating" aria-label="Первые шаги">
        <header>
          <div><b>Первые шаги</b><span className="guide-prog">{Math.min(step - 1, 4)} из 4</span></div>
          <button type="button" className="btn sm ghost" onClick={p.onClose} title="Скрыть гид (открыть снова — кнопка «?» вверху)"><Icon name="close" /></button>
        </header>
        <ol className="guide-steps">
          {items.map((it) => (
            <li key={it.n} className={it.done ? 'done' : it.n === step ? 'cur' : ''}>
              <span className="guide-n">{it.done ? <Icon name="check" /> : it.n}</span>
              <span>{it.title}</span>
            </li>
          ))}
        </ol>
        <div className="guide-body">
          {step === 1 ? (
            <>
              <p>Проект — это папка для объектов и пролётов одной сети или одного заказа. Создайте его, дайте понятное название.</p>
              <button type="button" className="btn sm primary" onClick={p.onNewProject}><Icon name="plus" />Создать проект</button>
            </>
          ) : step === 2 ? (
            <>
              <p>Объект — точка, где стоит антенна (вышка, мачта, крыша). Нужны два: по одному на каждом конце пролёта.{sites.length === 1 ? ' Один уже есть — добавьте ответный.' : ''} Поставьте точку кликом по карте или введите координаты.</p>
              <div className="guide-btns">
                <button type="button" className="btn sm primary" onClick={p.onAddSiteMap}><Icon name="pin" />Поставить на карте</button>
                <button type="button" className="btn sm" onClick={p.onAddSiteCoords}><Icon name="edit" />Ввести координаты</button>
              </div>
            </>
          ) : step === 3 ? (
            <>
              <p>Пролёт — радиорелейная линия между двумя объектами. После создания программа сама загрузит рельеф, здания, лес и воду на трассе (нужен интернет) и посчитает связь.</p>
              <button type="button" className="btn sm primary" onClick={p.onAddLink}><Icon name="link" />Создать пролёт</button>
            </>
          ) : step === 4 ? (
            !p.linkOpen ? (
              <>
                <p>Откройте пролёт: у него четыре вкладки с результатами.</p>
                <button type="button" className="btn sm primary" onClick={p.onOpenLink}><Icon name="link" />Открыть пролёт</button>
              </>
            ) : nextTab ? (
              <>
                {curTab ? <p className="guide-tab">Сейчас открыта <b>«{TAB_INFO.find((t) => t.k === curTab)!.title}»</b>: {TAB_INFO.find((t) => t.k === curTab)!.text}</p> : null}
                <p className="hint">Дальше нажмите вкладку <b>«{nextTab.title}»</b> в карточке пролёта — она подсвечена.</p>
                <div className="guide-tabs">
                  {TAB_INFO.map((t) => <span key={t.k} className={seen.has(t.k) ? 'on' : ''}>{t.title}</span>)}
                </div>
              </>
            ) : null
          ) : (
            <>
              {curTab === 'result' ? <p className="guide-tab">«Подробно»: {TAB_INFO[3].text}</p> : null}
              <p><b>Готово!</b> Вы прошли основные шаги. Дальше: поправьте высоты и антенны во вкладке «Исходные данные», сохраните отчёт кнопкой «PDF». Точку объекта можно передвинуть: наведите на неё курсор на карте → «Изменить положение».</p>
              <button type="button" className="btn sm primary" onClick={p.onClose}>Завершить</button>
            </>
          )}
        </div>
      </section>
    </>
  );
}
