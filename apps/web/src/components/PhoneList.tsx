import { useEffect, useId, useRef, useState } from 'react';
import { deviceKindLabel, type PublicPhone } from '@padel/core';
import { formatEventTime } from '../domain/log';
import { ConfirmDialog } from './ConfirmDialog';

interface PhoneListProps {
  readonly phones: readonly PublicPhone[];
  readonly onClose: () => void;
  readonly onKick: (seat: string) => void;
}

export function PhoneList({ phones, onClose, onKick }: PhoneListProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  onCloseRef.current = onClose;
  pendingRef.current = pending;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pendingRef.current) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const asked = phones.find((phone) => phone.seat === pending && !phone.self) ?? null;

  return (
    <div className="connect-overlay" data-testid="phone-list-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        className="connect-dialog phone-list"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="phone-list"
      >
        <div className="connect-dialog-bar">
          <button ref={closeRef} type="button" className="connect-x" data-testid="phone-list-close" aria-label="Close" onClick={onClose}>
            X
          </button>
        </div>
        <h2 id={titleId}>Connected phones</h2>
        <ul className="phone-rows">
          {phones.map((phone) => {
            const kind = deviceKindLabel(phone.kind);
            const status = phone.online ? 'Connected' : 'Not connected';
            return (
              <li
                key={`${phone.seat}-${phone.since}`}
                className="phone-row"
                data-testid="phone-row"
                data-kind={phone.kind}
                data-online={phone.online ? 'yes' : 'no'}
                data-self={phone.self ? 'yes' : 'no'}
              >
                <span className={phone.online ? 'phone-dot is-on' : 'phone-dot'} data-testid="phone-dot" aria-hidden="true" />
                <span className="phone-copy">
                  <span className="phone-line">
                    <span className="phone-kind">{kind}</span>
                    {phone.self ? <span className="phone-self"> · This device</span> : null}
                  </span>
                  <span className="phone-line phone-meta">
                    {phone.online ? `Since ${formatEventTime(phone.since)}` : `Last seen ${formatEventTime(phone.seen)}`}
                  </span>
                  <span className="sr-only">{status}</span>
                </span>
                {phone.self ? null : (
                  <button
                    type="button"
                    className="phone-kick"
                    data-testid={`kick-${phone.seat}`}
                    aria-label={`Remove ${kind}`}
                    onClick={() => setPending(phone.seat)}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {asked ? (
        <ConfirmDialog
          titleId="kick-title"
          title="Remove this phone?"
          body="They can only come back with a new code."
          confirmLabel="Remove"
          confirmTestId="kick-confirm"
          cancelTestId="kick-cancel"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const seat = asked.seat;
            setPending(null);
            onKick(seat);
          }}
        />
      ) : null}
    </div>
  );
}
