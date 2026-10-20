import { useEffect, useRef, type ReactNode } from 'react';

/** Modal side sheet (bottom sheet on mobile) built on <dialog> for focus trapping and Esc to close. */
export function Sheet({ open, onClose, title, wide, children }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`sheet${wide ? ' sheet-wide' : ''}`}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="sheet-title"
    >
      {open && (
        <div className="sheet-body">
          <header className="sheet-head">
            <h2 id="sheet-title">{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
