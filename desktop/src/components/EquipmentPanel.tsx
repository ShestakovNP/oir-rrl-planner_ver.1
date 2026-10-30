/** Equipment library editor: radios (modulation tables) and antennas. */
import type { AntennaModel, Radio } from '../data/types';
import { dishGain } from '../data/calc/physics';
import { useStore } from '../state/store';
import { Field, Icon, NumField, UnitField } from './ui';
import { FREQ_UNITS, GAIN_UNITS, LENGTH_UNITS } from '../data/units';

export function RadioPanel({ radio, onClose, onDelete }: { radio: Radio; onClose(): void; onDelete(): void }) {
  const { library, saveLibrary } = useStore();
  const set = (patch: Partial<Radio>) => saveLibrary({ ...library, radios: library.radios.map((r) => (r.id === radio.id ? { ...r, ...patch } : r)) });
  const setMode = (k: number, patch: Partial<Radio['modes'][number]>) => set({ modes: radio.modes.map((m, j) => (j === k ? { ...m, ...patch } : m)) });
  const id = (s: string) => `${radio.id}-${s}`;
  return (
    <aside className="panel" aria-label="ППУ (приёмо-передающее устройство)">
      <div className="panel-head" style={{ paddingBottom: 12 }}>
        <div className="panel-title">
          <div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow">ППУ (приёмо-передающее устройство)</div><h2>{radio.name || 'Новое ППУ'}</h2></div>
          <button className="btn sm danger" type="button" onClick={onDelete} title="Удалить"><Icon name="trash" /></button>
          <button className="btn sm ghost" type="button" onClick={onClose} title="Закрыть"><Icon name="close" /></button>
        </div>
      </div>
      <div className="panel-body">
        <div className="grid2">
          <Field label="Название" htmlFor={id('n')} className="span2"><input id={id('n')} className="input" value={radio.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Диапазон" htmlFor={id('b')}><input id={id('b')} className="input" value={radio.band} onChange={(e) => set({ band: e.target.value })} placeholder="например, 18 ГГц" /></Field>
        </div>
        <div className="section">
          <h3>Режимы модуляции <span className="hint">из паспорта</span></h3>
          <div className="tbl-wrap">
            <table className="tbl edit">
              <thead><tr><th>Режим</th><th className="n">Мбит/с</th><th className="n">Мощность, дБм</th><th className="n">Порог, дБм</th><th /></tr></thead>
              <tbody>
                {radio.modes.map((m, k) => (
                  <tr key={k}>
                    <td><input id={id('mn' + k)} className="input" value={m.name} onChange={(e) => setMode(k, { name: e.target.value })} aria-label="Режим" /></td>
                    <td><NumField id={id('mr' + k)} value={m.rateMbps} onChange={(v) => setMode(k, { rateMbps: v ?? 0 })} ariaLabel="Скорость" /></td>
                    <td><NumField id={id('mp' + k)} value={m.txDbm} onChange={(v) => setMode(k, { txDbm: v ?? 0 })} ariaLabel="Мощность" /></td>
                    <td><NumField id={id('mt' + k)} value={m.thresholdDbm} onChange={(v) => setMode(k, { thresholdDbm: v ?? -70 })} ariaLabel="Порог" /></td>
                    <td><button type="button" className="x" aria-label="Удалить режим" onClick={() => set({ modes: radio.modes.filter((_, j) => j !== k) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button type="button" className="btn sm" onClick={() => { const l = radio.modes[radio.modes.length - 1]; set({ modes: [...radio.modes, l ? { ...l, name: 'Новый' } : { name: 'QPSK', rateMbps: 40, txDbm: 20, thresholdDbm: -80 }] }); }}><Icon name="plus" />Режим</button></div>
          <p className="hint">Изменения не меняют уже рассчитанные пролёты: режимы копируются в пролёт при выборе ППУ.</p>
        </div>
        <Field label="Заметки" htmlFor={id('notes')}><textarea id={id('notes')} className="textarea" style={{ fontFamily: 'var(--f-ui)' }} rows={3} value={radio.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </aside>
  );
}

export function AntennaPanel({ ant, onClose, onDelete }: { ant: AntennaModel; onClose(): void; onDelete(): void }) {
  const { library, saveLibrary } = useStore();
  const set = (patch: Partial<AntennaModel>) => saveLibrary({ ...library, antennas: library.antennas.map((a) => (a.id === ant.id ? { ...a, ...patch } : a)) });
  const setGain = (k: number, patch: Partial<AntennaModel['gains'][number]>) => set({ gains: ant.gains.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
  const id = (s: string) => `${ant.id}-${s}`;
  const last = ant.gains[ant.gains.length - 1];
  return (
    <aside className="panel" aria-label="Антенна">
      <div className="panel-head" style={{ paddingBottom: 12 }}>
        <div className="panel-title">
          <div style={{ flex: 1, minWidth: 0 }}><div className="eyebrow">Антенна</div><h2>{ant.name.trim() || 'Новая антенна'}</h2></div>
          <button className="btn sm danger" type="button" onClick={onDelete} title="Удалить"><Icon name="trash" /></button>
          <button className="btn sm ghost" type="button" onClick={onClose} title="Закрыть"><Icon name="close" /></button>
        </div>
      </div>
      <div className="panel-body">
        <div className="grid2">
          <Field label="Название" htmlFor={id('n')} className="span2" hint="Можно изменить в любой момент: название обновится в справочнике и в пролётах при следующем выборе антенны.">
            <input id={id('n')} className="input" value={ant.name} placeholder="Введите название, например Andrew VHLP2-6W" onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Диаметр" htmlFor={id('d')}>
            <UnitField id={id('d')} value={ant.diameterM} unit={ant.diameterUnit ?? 'm'} units={LENGTH_UNITS} min={0.05} ariaLabel="Диаметр"
              onChange={(v) => set({ diameterM: v ?? 0.6 })} onUnit={(u) => set({ diameterUnit: u })} />
          </Field>
        </div>
        <div className="section">
          <div className="tbl-wrap">
            <table className="tbl edit">
              <thead><tr><th>Рабочая частота</th><th>Коэффициент усиления антенны</th><th /></tr></thead>
              <tbody>
                {ant.gains.map((g, k) => (
                  <tr key={k}>
                    <td><UnitField id={id('gf' + k)} value={g.freqGHz} unit={g.freqUnit ?? 'GHz'} units={FREQ_UNITS} min={0.0001} ariaLabel="Рабочая частота"
                      onChange={(v) => setGain(k, { freqGHz: v ?? 6 })} onUnit={(u) => setGain(k, { freqUnit: u })} /></td>
                    <td><UnitField id={id('gg' + k)} value={g.gainDbi} unit={g.gainUnit ?? 'dB'} units={GAIN_UNITS} digits={2} ariaLabel="Коэффициент усиления"
                      onChange={(v) => setGain(k, { gainDbi: v ?? 30 })} onUnit={(u) => setGain(k, { gainUnit: u })} /></td>
                    <td><button type="button" className="x" aria-label="Удалить строку" onClick={() => set({ gains: ant.gains.filter((_, j) => j !== k) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div><button type="button" className="btn sm" onClick={() => set({ gains: [...ant.gains, { freqGHz: 6, gainDbi: +dishGain(ant.diameterM, 6).toFixed(1), freqUnit: last?.freqUnit ?? 'GHz', gainUnit: last?.gainUnit ?? 'dB' }] })}><Icon name="plus" />Рабочая частота</button></div>
          <div className="hint" style={{ display: 'grid', gap: 6 }}>
            <p className="hint">Единицы измерения выбираются для того, чтобы вводить значения в том виде, в каком они указаны в паспорте антенны: впишите число из паспорта и выберите ту же единицу. Программа сама переведёт его в расчётные единицы (ГГц и дБи), поэтому результат расчёта от выбранной единицы не зависит.</p>
            <p className="hint"><b>Рабочая частота:</b> ГГц, МГц или кГц — как удобнее. <b>Коэффициент усиления антенны:</b> дБ, дБи и дБм принимаются как одно и то же значение относительно изотропного излучателя; дБд — относительно полуволнового диполя, программа прибавит 2,15 дБ.</p>
            <p className="hint">При выборе антенны в пролёте коэффициент усиления подставляется для рабочей частоты каждого канала, между указанными частотами — интерполируется. Если таблица пустая, он рассчитывается из диаметра антенны (КИП 55 %).</p>
          </div>
        </div>
        <Field label="Заметки" htmlFor={id('notes')}><textarea id={id('notes')} className="textarea" style={{ fontFamily: 'var(--f-ui)' }} rows={3} value={ant.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </aside>
  );
}
