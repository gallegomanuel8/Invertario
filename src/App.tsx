import { useEffect, useState } from 'react';
import { Catalog } from './components/Catalog';
import { Portfolio } from './components/Portfolio';
import { catalog } from './data';

type Route = 'catalogo' | 'cartera';
const readRoute = (): Route => (location.hash === '#/cartera' ? 'cartera' : 'catalogo');

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a href="#/" className="brand">
            <img src="/favicon.svg" alt="" width={28} height={28} />
            Invertario
          </a>
          <nav>
            <a href="#/" aria-current={route === 'catalogo' ? 'page' : undefined}>Catálogo</a>
            <a href="#/cartera" aria-current={route === 'cartera' ? 'page' : undefined}>Mi cartera</a>
          </nav>
        </div>
      </header>
      <main className="container">{route === 'catalogo' ? <Catalog /> : <Portfolio />}</main>
      <footer className="container footer muted small">
        Datos basados en la{' '}
        <a href={catalog.source} target="_blank" rel="noreferrer">hoja de cálculo mantenida por la comunidad</a>.
        Información orientativa; no constituye asesoramiento financiero.
      </footer>
    </>
  );
}
