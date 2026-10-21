import { useEffect, useState } from 'react';
import { Catalog } from './components/Catalog';
import { OPEN_DATA_EVENT } from './backup';
import { DataManager } from './components/DataManager';
import { Sheet } from './components/Sheet';
import { Portfolio } from './components/Portfolio';
import { Simulator } from './components/Simulator';
import { catalog } from './data';

type Route = 'catalogo' | 'simulador' | 'cartera';
const readRoute = (): Route =>
  location.hash.startsWith('#/cartera') ? 'cartera' : location.hash.startsWith('#/simulador') ? 'simulador' : 'catalogo';

type Theme = 'auto' | 'light' | 'dark';
const THEME_KEY = 'invertario.theme';
const THEME_LABEL: Record<Theme, string> = { auto: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: oscuro' };
const THEME_ICON: Record<Theme, string> = { auto: '◐', light: '☀', dark: '☾' };

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [dataOpen, setDataOpen] = useState(false);

  useEffect(() => {
    const open = () => setDataOpen(true);
    addEventListener(OPEN_DATA_EVENT, open);
    return () => removeEventListener(OPEN_DATA_EVENT, open);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      if (theme === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* preference just won't persist */
    }
  }, [theme]);

  const nextTheme = () => setTheme((t) => (t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'));

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a href="#/" className="brand">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            <span className="brand-text">Invertario</span>
          </a>
          <nav>
            <a href="#/" aria-current={route === 'catalogo' ? 'page' : undefined}>Catálogo</a>
            <a href="#/simulador" aria-current={route === 'simulador' ? 'page' : undefined}>Simulador</a>
            <a href="#/cartera" aria-current={route === 'cartera' ? 'page' : undefined}>Mi cartera</a>
            <button className="theme-toggle" onClick={() => setDataOpen(true)} aria-label="Tus datos: exportar, importar o borrar" title="Tus datos">
              <span aria-hidden>⇅</span>
            </button>
            <button className="theme-toggle" onClick={nextTheme} aria-label={`${THEME_LABEL[theme]}. Cambiar tema`} title={THEME_LABEL[theme]}>
              <span aria-hidden>{THEME_ICON[theme]}</span>
            </button>
          </nav>
        </div>
      </header>
      <main className="container">
        {route === 'catalogo' ? <Catalog /> : route === 'simulador' ? <Simulator key={location.hash} /> : <Portfolio />}
      </main>
      <footer className="container footer muted small">
        Datos basados en la{' '}
        <a href={catalog.source} target="_blank" rel="noreferrer">hoja de cálculo mantenida por la comunidad</a>.
        Información orientativa; no constituye asesoramiento financiero.{' '}
        <button className="link small" onClick={() => setDataOpen(true)}>Tus datos: exportar, importar o borrar</button>
      </footer>
      <Sheet open={dataOpen} onClose={() => setDataOpen(false)} title="Tus datos">
        <DataManager />
      </Sheet>
    </>
  );
}
