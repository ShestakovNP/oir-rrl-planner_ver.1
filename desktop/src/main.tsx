import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './state/store';
import { OirMark } from './brand/Logo';
import { interceptExternalLinks } from './net/external';
import './styles.css';

interceptExternalLinks();

function Splash({ error }: { error: string | null }) {
  return (
    <div className="loading">
      <div style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
        <OirMark size={56} />
        {error ? (
          <div style={{ maxWidth: 460, textAlign: 'center' }}>
            <b>Не удалось открыть базу данных.</b>
            <p className="hint">{error}</p>
            <p className="hint">Закройте другие окна программы и запустите её снова. Если ошибка повторится, сохраните папку с данными и переустановите программу.</p>
          </div>
        ) : <span>Загрузка…</span>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider fallback={(err) => <Splash error={err} />}>
      <App />
    </StoreProvider>
  </StrictMode>
);
