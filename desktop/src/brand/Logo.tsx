/** ОИР mark: two masts and the Fresnel zone between them. Same geometry as oir-mark.svg. */
import { useId } from 'react';

export function OirMark({ size = 26, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#16395F" />
          <stop offset="1" stopColor="#0B1F35" />
        </linearGradient>
        <linearGradient id={`ln${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#38C6B0" />
          <stop offset="1" stopColor="#4FA3FF" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#bg${id})`} />
      <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#ffffff" strokeOpacity=".08" />
      <path d="M15 22.5 Q32 11 49 29.5 Q32 41 15 22.5 Z" fill={`url(#ln${id})`} fillOpacity=".38" />
      <path d="M15 22.5 Q32 11 49 29.5 Q32 41 15 22.5 Z" fill="none" stroke={`url(#ln${id})`} strokeWidth="1.6" />
      <line x1="15" y1="22.5" x2="49" y2="29.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 22.5 V48 M49 29.5 V48" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M10 48 H54" stroke="#fff" strokeOpacity=".28" strokeWidth="2" strokeLinecap="round" />
      <circle cx="15" cy="22.5" r="3.4" fill="#38C6B0" stroke="#fff" strokeWidth="1.6" />
      <circle cx="49" cy="29.5" r="3.4" fill="#4FA3FF" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand" title="ОИР — Отдел инфраструктурных решений">
      <OirMark size={26} />
      <b>ОИР</b>
      <span>RRL Planner</span>
    </div>
  );
}
