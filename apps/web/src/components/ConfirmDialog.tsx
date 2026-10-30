import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTestId: string;
  cancelTestId?: string;
  cancelLabel?: string;
  alternateLabel?: string;
  alternateTestId?: string;
  titleId: string;
  check?: {
    readonly label: string;
    readonly checked: boolean;
    readonly testId: string;
    readonly onChange: (checked: boolean) => void;
  };
  onConfirm: () => void;
  onAlternate?: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmTestId,
  cancelTestId,
  cancelLabel,
  alternateLabel,
  alternateTestId,
  titleId,
  check,
  onConfirm,
  onAlternate,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    try {
      if (!dialog.open) dialog.showModal();
    } catch {
      // The native dialog is unavailable; the buttons still work.
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p>{body}</p>
      {check ? (
        <label className="dialog-check">
          <input
            type="checkbox"
            data-testid={check.testId}
            checked={check.checked}
            onChange={(event) => check.onChange(event.target.checked)}
          />
          {check.label}
        </label>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" data-testid={cancelTestId} autoFocus onClick={onCancel}>
          {cancelLabel ?? 'Cancel'}
        </button>
        {alternateLabel && onAlternate ? (
          <button type="button" className="btn btn-ghost" data-testid={alternateTestId} onClick={onAlternate}>
            {alternateLabel}
          </button>
        ) : null}
        <button type="button" className="btn btn-solid" data-testid={confirmTestId} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
