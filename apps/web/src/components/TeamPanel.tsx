import { canIncrement, canTakeGame, displayGames, isUpcomingSet, serveChoice, setWinner } from '../domain/rules';
import type { MatchState, SetIndex, TeamId } from '../domain/types';
import { BallIcon, MinusIcon, PlusIcon } from './icons';
import { SetScore } from './SetScore';
import { SplitFlap } from './SplitFlap';
import { TeamName } from './TeamName';

interface TeamPanelProps {
  team: TeamId;
  state: MatchState;
  onIncrement: (team: TeamId) => void;
  onDecrement: (team: TeamId) => void;
  onRename: (team: TeamId, name: string) => void;
  onSelectSet: (index: SetIndex) => void;
  onServe: (team: TeamId) => void;
}

const SETS: readonly SetIndex[] = [0, 1, 2];

export function TeamPanel({ team, state, onIncrement, onDecrement, onRename, onSelectSet, onServe }: TeamPanelProps) {
  const name = state.teams[team].name;
  const active = state.sets[state.activeSet];
  const locked = state.ended;
  const plusDisabled = locked || !canIncrement(active, team);
  const minusDisabled = locked || !canTakeGame(state, team);
  const activeWinner = setWinner(active.a, active.b);
  const asking = state.serveAsk === team && state.serve === null;
  const serving = state.serve?.team === team || asking;
  const nextServe = serveChoice(state.serve, team);
  const serveLabel = asking
    ? `Choose the player for ${name}`
    : nextServe
      ? `Serve ${nextServe.team.toUpperCase()}${nextServe.player} for ${name}`
      : `Leave the serve open, ${name}`;

  return (
    <section className={`team team-${team}`} aria-label={name}>
      <button
        type="button"
        className="step step-minus"
        data-testid={`decrement-${team}`}
        disabled={minusDisabled}
        aria-label={`${name}: remove one game`}
        onClick={() => onDecrement(team)}
      >
        <MinusIcon />
      </button>
      <div className="team-body">
        <div className="team-head">
          <TeamName name={name} locked={locked} onCommit={(next) => onRename(team, next)} />
          <button
            type="button"
            className={serving ? 'ball is-on' : 'ball'}
            data-testid={`serve-${team}`}
            aria-pressed={serving}
            aria-label={serveLabel}
            disabled={locked}
            onClick={() => onServe(team)}
          >
            <BallIcon />
            {serving && state.serve ? (
              <span className="serve-player" data-testid={`serve-player-${team}`}>
                {state.serve.player}
              </span>
            ) : null}
          </button>
        </div>
        <div className={`current-set${activeWinner === team ? ' is-won' : ''}`} data-testid={`current-${team}`} aria-hidden="true">
          <SplitFlap value={displayGames(state, state.activeSet, team)} />
        </div>
        <div className="sets">
          {SETS.map((index) => {
            const score = state.sets[index];
            const winner = setWinner(score.a, score.b);
            return (
              <SetScore
                key={index}
                team={team}
                index={index}
                gamesLabel={displayGames(state, index, team)}
                active={state.activeSet === index}
                won={winner === team}
                upcoming={isUpcomingSet(state, index)}
                locked={locked}
                onSelect={() => onSelectSet(index)}
              />
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="step step-plus"
        data-testid={`increment-${team}`}
        disabled={plusDisabled}
        aria-label={`${name}: add one game`}
        onClick={() => onIncrement(team)}
      >
        <PlusIcon />
      </button>
    </section>
  );
}
