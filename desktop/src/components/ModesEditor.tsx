/**
 * Table of modulation types of a radio (ППУ): type from a list, rate, power and threshold
 * taken from the radio datasheet. Shared by the link inputs and the equipment library.
 */
import type { ModMode } from '../data/types';
import { Icon, NumField } from './ui';

export const MOD_TYPES = ['QPSK', 'QAM16', 'QAM64', 'QAM256'];
const TIP = 'Значение из паспорта ППУ';

export function ModesEditor({ idBase, modes, onChange }: { idBase: string; modes: ModMode[]; onChange(m: ModMode[]): void }) {
  const setMode = (k: number, patch: Partial<ModMode>) => onChange(modes.map((m, j) => (j === k ? { ...m, ...patch } : m)));
  const add = () => {
    const used = new Set(modes.map((m) => m.name));
    const name = MOD_TYPES.find((t) => !used.has(t)) ?? MOD_TYPES[MOD_TYPES.length - 1];
    onChange([...modes, { name, rateMbps: 0, txDbm: 0, thresholdDbm: 0 }]);
  };
  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl edit">
          <thead><tr><th>Тип модуляции</th><th className="n">Мбит/с</th><th className="n">Мощность, дБм</th><th className="n">Порог, дБм</th><th /></tr></thead>
          <tbody>
            {modes.map((m, k) => (
              <tr key={k}>
                <td>
                  <select id={`${idBase}-mn${k}`} className="select" value={m.name} onChange={(e) => setMode(k, { name: e.target.value })} aria-label="Тип модуляции">
                    {MOD_TYPES.includes(m.name) ? null : <option value={m.name}>{m.name}</option>}
                    {MOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td><span className="tip-wrap" data-tip={TIP}><NumField id={`${idBase}-mr${k}`} value={m.rateMbps} min={0} onChange={(v) => setMode(k, { rateMbps: v ?? 0 })} ariaLabel="Скорость, Мбит/с" /></span></td>
                <td><span className="tip-wrap" data-tip={TIP}><NumField id={`${idBase}-mp${k}`} value={m.txDbm} onChange={(v) => setMode(k, { txDbm: v ?? 0 })} ariaLabel="Мощность передатчика, дБм" /></span></td>
                <td><span className="tip-wrap" data-tip={TIP}><NumField id={`${idBase}-mt${k}`} value={m.thresholdDbm} onChange={(v) => setMode(k, { thresholdDbm: v ?? 0 })} ariaLabel="Порог приёмника, дБм" /></span></td>
                <td><button type="button" className="x" aria-label="Удалить тип модуляции" onClick={() => onChange(modes.filter((_, j) => j !== k))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modes.some(incomplete) ? <p className="hint warn-text">Строки с нулевой скоростью или порогом 0 дБм не участвуют в расчёте — внесите значения из паспорта ППУ.</p> : null}
      <div><button type="button" className="btn sm" onClick={add}><Icon name="plus" />Тип модуляции</button></div>
    </>
  );
}

/** A row is not filled in yet: no rate or a threshold of 0 dBm (never a real value). */
export const incomplete = (m: ModMode) => !(m.rateMbps > 0) || !(m.thresholdDbm < 0);
