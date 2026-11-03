/** Small shared UI pieces: icons, number field, dialogs, toasts. */
import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ---------- icons (stroke, 16px) ---------- */
const P: Record<string, string> = {
  search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
  plus: 'M8 3v10M3 8h10',
  pin: 'M8 14.5s4.5-4.2 4.5-7.5a4.5 4.5 0 1 0-9 0c0 3.3 4.5 7.5 4.5 7.5zM8 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  link: 'M3 12.5 13 3.5M3 12.5a1.5 1.5 0 1 1-.01 0M13 3.5a1.5 1.5 0 1 1-.01 0',
  file: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3',
  layers: 'M8 2 1.5 5.5 8 9l6.5-3.5zM1.5 8.5 8 12l6.5-3.5M1.5 11.5 8 15l6.5-3.5',
  close: 'M4 4l8 8M12 4l-8 8',
  trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4',
  download: 'M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3',
  upload: 'M8 11V3M4.5 6.5 8 3l3.5 3.5M2.5 13.5h11',
  target: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 0v3M8 13v3M0 8h3M13 8h3',
  radio: 'M3 6h10v8H3zM5.5 6 11 1.5M5.5 9.5h1M9 9.5h1.5',
  dish: 'M3 3a9 9 0 0 0 10 10M3 3l6 6M9 9l3.5-1.5M3 13h4',
  mountain: 'M1 13.5 6 5l3 5 2-3 4 6.5z',
  pdf: 'M4 1.5h5l3 3v10H4zM9 1.5v3h3M6 9h4M6 11.5h4',
  moon: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v4M8 5h.01',
  menu: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  edit: 'M10.5 2.5l3 3L6 13H3v-3z',
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
  check: 'M3 8.5l3.2 3.2L13 4.8',
  chevron: 'M4 6l4 4 4-4'
};
export function Icon({ name, className = 'icon' }: { name: keyof typeof P | string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] || ''} />
    </svg>
  );
}

/* ---------- numbers ---------- */
export const parseNum = (s: string): number => {
  const v = parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
};
const show = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : String(+v.toFixed(6)).replace('.', ','));

/**
 * Text field for numbers that accepts "," or "." and lets the user type freely;
 * commits only valid numbers. `nullable` makes an empty field mean null.
 */
export function NumField(props: {
  id: string; value: number | null; onChange(v: number | null): void; nullable?: boolean; placeholder?: string;
  min?: number; max?: number; className?: string; ariaLabel?: string; disabled?: boolean;
}) {
  const { value, onChange, nullable, min, max } = props;
  const [text, setText] = useState(show(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setText(show(value)); setBad(false); } }, [value]);
  const commit = (s: string) => {
    if (!s.trim()) {
      if (nullable) { setBad(false); onChange(null); } else setBad(true);
      return;
    }
    const v = parseNum(s);
    if (!Number.isFinite(v) || (min != null && v < min) || (max != null && v > max)) { setBad(true); return; }
    setBad(false);
    if (v !== value) onChange(v);
  };
  return (
    <input
      id={props.id} className={`input num ${bad ? 'invalid' : ''} ${props.className ?? ''}`} inputMode="decimal" value={text}
      placeholder={props.placeholder} aria-label={props.ariaLabel} aria-invalid={bad || undefined} disabled={props.disabled}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(show(value)); setBad(false); }}
      onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
    />
  );
}

/** A number box with a unit selector next to it. `value` is always in the base unit. */
export function UnitField<Id extends string>(props: {
  id: string; value: number | null; unit: Id; units: { id: Id; label: string; toBase(v: number): number; fromBase(v: number): number }[];
  onChange(v: number | null): void; onUnit(u: Id): void; nullable?: boolean; min?: number; placeholder?: string; ariaLabel?: string; digits?: number;
}) {
  const u = props.units.find((x) => x.id === props.unit) ?? props.units[0];
  const shown = props.value == null ? null : +u.fromBase(props.value).toFixed(props.digits ?? 6);
  return (
    <div className="unitfield">
      <NumField
        id={props.id} value={shown} nullable={props.nullable} placeholder={props.placeholder} ariaLabel={props.ariaLabel}
        min={props.min != null ? u.fromBase(props.min) : undefined}
        onChange={(v) => props.onChange(v == null ? null : u.toBase(v))}
      />
      <select className="select" aria-label={(props.ariaLabel ?? '') + ', единица измерения'} value={u.id} onChange={(e) => props.onUnit(e.target.value as Id)}>
        {props.units.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </div>
  );
}

export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

/** Renders **bold** markers from calculation texts. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*/);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</>;
}

/* ---------- dialogs ---------- */
export interface DialogSpec {
  title: string;
  body?: ReactNode;
  confirm?: string;
  danger?: boolean;
  cancel?: string | null;
  input?: { label: string; value: string; optional?: boolean; multiline?: boolean; placeholder?: string };
  /** Extra button between «Отмена» and the main one. */
  alt?: { label: string; onClick(): void };
  wide?: boolean;
  onConfirm?(value?: string): void;
}

export function Dialog({ spec, onClose }: { spec: DialogSpec; onClose(): void }) {
  const [val, setVal] = useState(spec.input?.value ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (ref.current ?? okRef.current)?.focus();
    ref.current?.select();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const ok = () => {
    if (spec.input && !spec.input.optional && !val.trim()) return;
    spec.onConfirm?.(spec.input ? val.trim() : undefined);
    onClose();
  };
  return (
    <div className="overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={`dialog ${spec.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={spec.title} onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <h2>{spec.title}</h2>
        {spec.body ? <div>{spec.body}</div> : null}
        {spec.input ? (
          <Field label={spec.input.label} htmlFor="dlg-input">
            {spec.input.multiline
              ? <textarea id="dlg-input" autoFocus className="textarea" rows={4} value={val} placeholder={spec.input.placeholder} onChange={(e) => setVal(e.target.value)} style={{ fontFamily: 'var(--f-ui)', height: 'auto', padding: '6px 9px' }} />
              : <input id="dlg-input" ref={ref} className="input" value={val} placeholder={spec.input.placeholder} onChange={(e) => setVal(e.target.value)} />}
          </Field>
        ) : null}
        <div className="actions">
          {spec.cancel !== null ? <button type="button" className="btn" onClick={onClose}>{spec.cancel ?? 'Отмена'}</button> : null}
          {spec.alt ? <button type="button" className="btn" onClick={() => { spec.alt!.onClick(); onClose(); }}>{spec.alt.label}</button> : null}
          <button ref={okRef} type="submit" className={`btn ${spec.danger ? 'danger' : 'primary'}`}>{spec.confirm ?? 'OK'}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- toasts ---------- */
export interface Toast { id: number; text: string; error?: boolean }
export function Toasts({ items }: { items: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>{t.text}</div>)}
    </div>
  );
}

/** Closes a popup on outside click / Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}
