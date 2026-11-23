import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ConfirmDialogConfig } from '../types/backup';

interface ConfirmDialogProps {
  config: ConfirmDialogConfig | null;
  onClose: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ config, onClose }) => {
  const [busy, setBusy] = useState(false);

  if (!config) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await config.onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-[#2B3442] bg-[#12161C] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#1E242D] px-6 py-4">
          <div className="flex items-center gap-3">
            <AlertTriangle
              className={`h-5 w-5 shrink-0 ${
                config.destructive ? 'text-red-400' : 'text-amber-400'
              }`}
            />
            <h3
              id="confirm-dialog-title"
              className="text-base font-semibold text-[#E6EDF3]"
            >
              {config.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close confirmation dialog"
            className="rounded p-1 text-[#8B949E] transition-colors hover:bg-[#1C222B] hover:text-[#E6EDF3] focus-visible:outline-2 focus-visible:outline-emerald-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm leading-relaxed text-[#B1BAC4]">{config.description}</p>

          {config.affectedItems && config.affectedItems.length > 0 && (
            <div className="rounded-md border border-[#222933] bg-[#0B0E11] p-3">
              <div className="mb-2 text-xs font-medium text-[#8B949E]">
                Affected items ({config.affectedItems.length})
              </div>
              <ul className="max-h-36 space-y-1 overflow-y-auto font-mono text-xs text-[#E6EDF3]">
                {config.affectedItems.map((item, idx) => (
                  <li key={`${item}-${idx}`} className="truncate">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#1E242D] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[#2B3442] bg-[#161B22] px-4 py-2 text-sm font-medium text-[#C9D1D9] transition-colors hover:bg-[#1E2530] focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0"
          >
            {config.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0 ${
              config.destructive
                ? 'bg-red-600 text-white hover:bg-red-500 disabled:opacity-50'
                : 'bg-emerald-500 text-[#07110C] hover:bg-emerald-400 disabled:opacity-50'
            }`}
          >
            {busy ? 'Working...' : config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
