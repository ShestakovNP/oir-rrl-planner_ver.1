/**
 * One tooltip for every element with data-tip. Drawn in a fixed layer and kept inside the
 * window: under the element when there is room, above it otherwise, shifted left or right
 * so it never leaves the screen; long text wraps.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const GAP = 8, EDGE = 8;

export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; r: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cur: HTMLElement | null = null;
    const show = (el: HTMLElement | null) => {
      if (el === cur) return;
      cur = el;
      const text = el?.getAttribute('data-tip');
      setTip(el && text ? { text, r: el.getBoundingClientRect() } : null);
    };
    const over = (e: Event) => show((e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null);
    const hide = () => show(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', over);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) { setPos(null); return; }
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, { r } = tip;
    const cx = r.left + r.width / 2;
    const left = Math.max(EDGE, Math.min(vw - EDGE - w, cx - w / 2));
    const below = r.bottom + GAP + h <= vh - EDGE || r.top - GAP - h < EDGE;
    const top = below ? r.bottom + GAP : r.top - GAP - h;
    setPos({ left, top, arrow: Math.max(10, Math.min(w - 10, cx - left)), below });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className={`tip-layer ${pos ? 'on' : ''} ${pos?.below === false ? 'above' : ''}`} role="tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--arrow' as string]: `${pos?.arrow ?? 10}px` }}>
      {tip.text}
    </div>
  );
}
