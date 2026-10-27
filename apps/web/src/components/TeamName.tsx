import { useRef, useState } from 'react';
import { MAX_TEAM_NAME_UTF16_UNITS, clampTeamNameDraft } from '../domain/names';

interface TeamNameProps {
  name: string;
  locked: boolean;
  onCommit: (name: string) => void;
}

export function TeamName({ name, locked, onCommit }: TeamNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const cancel = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        className="team-name"
        disabled={locked}
        onClick={() => {
          if (locked) return;
          cancel.current = false;
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </button>
    );
  }

  return (
    <input
      className="team-name-input"
      value={draft}
      maxLength={MAX_TEAM_NAME_UTF16_UNITS}
      autoFocus
      enterKeyHint="done"
      autoCapitalize="words"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      aria-label="Team name"
      onChange={(event) => {
        setDraft(clampTeamNameDraft(event.target.value));
      }}
      onBlur={() => {
        setEditing(false);
        if (cancel.current) {
          cancel.current = false;
          return;
        }
        onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancel.current = true;
          setDraft(name);
          setEditing(false);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
