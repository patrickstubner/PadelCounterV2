import { useEffect, useState } from 'react';
import {
  installOffer,
  isIosSafari,
  isRunningStandalone,
  listenForInstallPrompt,
  readInstallClient,
  runInstallPrompt,
  storedPromptAfter,
  type InstallPromptLike,
  type InstallPromptOutcome,
} from '../installOffer';

export type InstallOfferController =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'ios' }
  | {
      readonly kind: 'prompt';
      readonly prompt: () => Promise<InstallPromptOutcome>;
    };

export function useInstallOffer(): InstallOfferController {
  const [client] = useState(readInstallClient);
  const [promptEvent, setPromptEvent] = useState<InstallPromptLike | null>(null);
  const [installed, setInstalled] = useState(false);
  const standalone = isRunningStandalone(client);

  useEffect(() => {
    if (standalone || typeof window === 'undefined') return;
    const stopPrompt = listenForInstallPrompt(window, setPromptEvent);
    const onInstalled = () => setInstalled(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      stopPrompt();
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [standalone]);

  const kind = installOffer({
    standalone: standalone || installed,
    iosSafari: isIosSafari(client),
    canPrompt: promptEvent !== null,
  });

  if (kind === 'prompt' && promptEvent) {
    const current = promptEvent;
    return {
      kind: 'prompt',
      prompt: async () => {
        const outcome = await runInstallPrompt(current);
        setPromptEvent(storedPromptAfter(current, outcome));
        return outcome;
      },
    };
  }
  if (kind === 'ios') return { kind: 'ios' };
  return { kind: 'hidden' };
}
