import { UPDATE_READY_LABEL } from '../registerServiceWorker';

interface UpdateReadyProps {
  onReload: () => void;
}

export function UpdateReady({ onReload }: UpdateReadyProps) {
  return (
    <button type="button" className="update-ready" data-testid="update-ready" onClick={onReload}>
      {UPDATE_READY_LABEL}
    </button>
  );
}
