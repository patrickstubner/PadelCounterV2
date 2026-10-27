import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { nextMenuIndex } from '../menuKeys';

export interface CourtAction {
  readonly id: string;
  readonly label: string;
  readonly testId: string;
  readonly disabled?: boolean;
  readonly emphasized?: boolean;
  /** Stays in the hamburger menu. The wide landscape bar skips it. */
  readonly menuOnly?: boolean;
  /** Shown as text, not a menu action. Used for the iOS home-screen hint. */
  readonly textOnly?: boolean;
  /** Complete instruction under a text-only row. */
  readonly detail?: string;
  readonly onSelect: () => void;
}

function menuActions(actions: readonly CourtAction[], mode: 'menu' | 'bar'): readonly CourtAction[] {
  if (mode === 'bar') return actions.filter((action) => !action.menuOnly);
  return [
    ...actions.filter((action) => !action.menuOnly),
    ...actions.filter((action) => action.menuOnly),
  ];
}

interface CourtHeaderProps {
  readonly setLabel: string;
  readonly onBrand: () => void;
  readonly actions: readonly CourtAction[];
  /** Tests pin the header. Otherwise a wide landscape shows the buttons. */
  readonly layout?: 'menu' | 'bar';
}

const WIDE_BAR = '(orientation: landscape) and (min-width: 900px)';

function useWideBar(): boolean {
  const [wide, setWide] = useState(
    () => typeof matchMedia === 'function' && matchMedia(WIDE_BAR).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(WIDE_BAR);
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export function CourtHeader({ setLabel, onBrand, actions, layout }: CourtHeaderProps) {
  const wide = useWideBar();
  const mode = layout ?? (wide ? 'bar' : 'menu');
  const shown = useMemo(() => menuActions(actions, mode), [actions, mode]);
  const commands = useMemo(() => shown.filter((action) => !action.textOnly), [shown]);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (mode !== 'menu' || !open || typeof document === 'undefined') return;
    const enabled = commands.findIndex((action) => !action.disabled);
    itemRefs.current[enabled]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [commands, mode, open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  };

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextMenuIndex(event.key, index, commands.map((action) => !action.disabled));
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (next === 'close') {
      close(true);
      return;
    }
    itemRefs.current[next]?.focus();
  };

  return (
    <header className="top">
      <h1 className="brand">
        <button type="button" className="brand-btn" data-testid="open-matches" onClick={onBrand}>
          Padel Counter V2
        </button>
      </h1>
      <p className="set-heading" data-testid="active-set">{setLabel}</p>
      {mode === 'bar' ? (
        <div className="top-actions">
          {shown.map((action) => (
            <button
              key={action.id}
              type="button"
              className={action.emphasized ? 'text-btn undo-btn' : 'text-btn'}
              data-testid={action.testId}
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="top-end">
          <button
            ref={toggleRef}
            type="button"
            className="menu-toggle"
            data-testid="menu-toggle"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              setOpen(true);
            }}
          >
            <span className="burger-line" />
            <span className="burger-line" />
            <span className="burger-line" />
          </button>
          <div ref={menuRef} className="match-menu" hidden={!open}>
            <div id={menuId} className="match-menu-actions" role="menu" aria-label="Match">
              {commands.map((action, index) => (
                <button
                  key={action.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  className={action.emphasized ? 'menu-item is-emphasis' : 'menu-item'}
                  data-testid={action.testId}
                  disabled={action.disabled}
                  tabIndex={open ? 0 : -1}
                  onClick={() => {
                    close(false);
                    action.onSelect();
                  }}
                  onKeyDown={(event) => onItemKeyDown(event, index)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            {shown.filter((action) => action.textOnly).map((action) => (
              <p key={action.id} className="menu-note" role="note" data-testid={action.testId}>
                {action.label}
                {action.detail ? <span className="menu-hint">{action.detail}</span> : null}
              </p>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
