import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function BottomSheet({ title, close, busy = false, children }: {
  title: string; close: () => void; busy?: boolean; children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="purchase-sheet" aria-labelledby={titleId}
    onCancel={event => {
      event.preventDefault();
      if (!busy) close();
    }}
    onClick={event => { if (!busy && event.target === event.currentTarget) close(); }}>
    <div className="purchase-sheet-content">
      <header className="purchase-sheet-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" aria-label="关闭" autoFocus disabled={busy} onClick={close}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {children}
    </div>
  </dialog>;
}
