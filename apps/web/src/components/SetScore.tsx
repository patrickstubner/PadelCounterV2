import { SplitFlap } from './SplitFlap';

interface SetScoreProps {
  team: 'a' | 'b';
  index: number;
  gamesLabel: string;
  active: boolean;
  won: boolean;
  upcoming: boolean;
  locked: boolean;
  onSelect: () => void;
}

export function SetScore({ team, index, gamesLabel, active, won, upcoming, locked, onSelect }: SetScoreProps) {
  const classes = [
    'set',
    active ? 'is-active' : '',
    won ? 'is-won' : '',
    upcoming ? 'is-upcoming' : '',
    !active && !upcoming ? 'is-played' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      data-testid={`set-${team}-${index + 1}`}
      aria-pressed={active}
      disabled={locked}
      aria-label={`Set ${index + 1}`}
      onClick={onSelect}
    >
      <SplitFlap value={gamesLabel} />
      <span className="marker" aria-hidden="true" />
    </button>
  );
}
