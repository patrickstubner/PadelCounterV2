import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTestId: string;
  cancelTestId?: string;
  cancelLabel?: string;
  titleId: string;
  /** Large tick boxes above the two buttons. Each one is its own choice. */
  checks?: readonly DialogCheck[];
  onConfirm: () => void;
  onCancel: () => void;
}

export interface DialogCheck {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly testId: string;
  readonly onChange: (checked: boolean) => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmTestId,
  cancelTestId,
  cancelLabel,
  titleId,
  checks,
  onConfirm,
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
      {checks?.map((check) => (
        <label key={check.testId} className="dialog-check">
          <input
            type="checkbox"
            data-testid={check.testId}
            checked={check.checked}
            onChange={(event) => check.onChange(event.target.checked)}
          />
          <span className="dialog-check-text">
            {check.label}
            {check.hint ? <span className="dialog-check-hint">{check.hint}</span> : null}
          </span>
        </label>
      ))}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" data-testid={cancelTestId} autoFocus onClick={onCancel}>
          {cancelLabel ?? 'Cancel'}
        </button>
        <button type="button" className="btn btn-solid" data-testid={confirmTestId} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
