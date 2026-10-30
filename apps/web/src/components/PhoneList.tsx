import { useEffect, useId, useRef } from 'react';
import { deviceKindLabel, type PublicPhone } from '@padel/core';
import { formatEventTime } from '../domain/log';

interface PhoneListProps {
  readonly phones: readonly PublicPhone[];
  readonly onClose: () => void;
}

export function PhoneList({ phones, onClose }: PhoneListProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
          {phones.map((phone) => (
            <li
              key={`${phone.seat}-${phone.since}`}
              className="phone-row"
              data-testid="phone-row"
              data-kind={phone.kind}
              data-online={phone.online ? 'yes' : 'no'}
              data-self={phone.self ? 'yes' : 'no'}
            >
              <span className="phone-kind">{deviceKindLabel(phone.kind)}</span>
              <span className="phone-since">{`Since ${formatEventTime(phone.since)}`}</span>
              <span className="phone-state">
                {phone.online ? 'Online' : `Offline, last seen ${formatEventTime(phone.seen)}`}
              </span>
              {phone.self ? <span className="phone-self">This device</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
