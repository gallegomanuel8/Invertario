import { useRef, useState } from 'react';
import { applyBackup, type Backup, clearAll, currentData, downloadBackup, parseBackup, summary } from '../backup';
import { fmtDate } from '../format';

const CONFIRM_WORD = 'BORRAR';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Tus datos" sheet body: export, import (merge/replace) and wipe everything stored in this browser. */
export function DataManager() {
  const now = summary(currentData());
  const [pending, setPending] = useState<Backup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [exported, setExported] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const empty = !now.funds && !now.sims;

  const pick = async (file: File) => {
    setError(null);
    try {
      setPending(parseBackup(await file.text()));
    } catch (e) {
      setPending(null);
      setError((e as Error).message);
    }
  };
  const apply = (mode: 'replace' | 'merge') => {
    if (!pending) return;
    if (mode === 'replace' && !empty && !confirm('Se sustituirán tus datos actuales por los de la copia. ¿Continuar?')) return;
    applyBackup(pending, mode);
    location.reload(); // every view re-reads storage on load
  };
  const wipe = () => {
    clearAll();
    location.hash = '#/';
    location.reload();
  };
  const incoming = pending && summary(pending.data);

  return (
    <div className="detail data-manager">
      <p className="muted">
        Invertario no tiene cuentas ni servidor de datos: todo se guarda <strong>solo en este navegador</strong>. Para usarlo en otro
        navegador o dispositivo, exporta una copia aquí e impórtala allí.
      </p>
      <dl className="kv">
        <dt>Fondos importados en Mi cartera</dt><dd>{now.funds} ({now.lots} lotes)</dd>
        <dt>Carteras simuladas</dt><dd>{now.sims}</dd>
      </dl>

      <section>
        <h3>Exportar</h3>
        <p className="small muted">Descarga un archivo <code>.json</code> con tu cartera, tus carteras simuladas y tus preferencias. Contiene tus importes: guárdalo en un lugar seguro.</p>
        <div className="detail-actions">
          <button className="btn btn-primary" onClick={() => { downloadBackup(); setExported(true); }} disabled={empty}>Descargar copia</button>
          {exported && <span className="small added" role="status">Copia descargada.</span>}
        </div>
      </section>

      <section>
        <h3>Importar</h3>
        <p className="small muted">Carga una copia exportada desde Invertario.</p>
        <input ref={input} type="file" accept=".json,application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
        <button className="btn" onClick={() => input.current?.click()}>Elegir archivo…</button>
        {error && <p className="errors" role="alert">{error}</p>}
        {pending && incoming && (
          <div className="import-preview">
            <p>
              Copia del <strong>{fmtDate(pending.exportedAt)}</strong>: {plural(incoming.funds, 'fondo', 'fondos')} ({plural(incoming.lots, 'lote', 'lotes')}) y {plural(incoming.sims, 'cartera simulada', 'carteras simuladas')}.
            </p>
            <div className="detail-actions">
              {!empty && <button className="btn btn-primary" onClick={() => apply('merge')}>Combinar con mis datos</button>}
              <button className={`btn${empty ? ' btn-primary' : ''}`} onClick={() => apply('replace')}>
                {empty ? 'Importar' : 'Reemplazar mis datos'}
              </button>
              <button className="btn" onClick={() => setPending(null)}>Cancelar</button>
            </div>
            {!empty && <p className="small muted">Combinar mantiene lo que tienes y añade o actualiza los fondos (por ISIN) y las carteras simuladas de la copia.</p>}
          </div>
        )}
      </section>

      <section className="danger-zone">
        <h3>Borrar todos los datos</h3>
        <div className="warning" role="note">
          <p><strong>⚠️ Esta acción no se puede deshacer.</strong> Se eliminarán de este navegador:</p>
          <ul>
            <li>Tu cartera importada ({now.funds} fondos, {now.lots} lotes) y los nombres y datos de fondos identificados.</li>
            <li>Todas tus carteras simuladas ({now.sims}).</li>
            <li>Tus preferencias (tema).</li>
          </ul>
          <p>
            Invertario no guarda copias en ningún servidor, así que <strong>no hay forma de recuperarlos</strong> salvo que tengas
            una copia exportada. Los enlaces de carteras que hayas compartido seguirán funcionando.
          </p>
        </div>
        {!empty && (
          <p className="small">
            ¿Aún no tienes copia? <button className="link" onClick={() => { downloadBackup(); setExported(true); }}>Descárgala antes de borrar</button>.
          </p>
        )}
        <label className="field">
          <span className="small">Escribe <strong>{CONFIRM_WORD}</strong> para confirmar</span>
          <input className="confirm-input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <button className="btn btn-danger-solid" disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD} onClick={wipe}>
          Borrar todos mis datos
        </button>
      </section>
    </div>
  );
}
