import type { ReactNode } from "react";
import { Button } from "./Button";

export function Modal({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal ${className}`.trim()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </header>
        {children}
      </div>
    </div>
  );
}
