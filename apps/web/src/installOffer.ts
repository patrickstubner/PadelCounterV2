/** Home-screen install offer. A 1.2.4-style browser tab stays in the menu; standalone hides it. */

export const INSTALL_LABEL = 'Add to Home Screen';
/** Complete iOS instruction. It is not shortened. */
export const IOS_INSTALL_HINT = 'Share → Add to Home Screen';

export interface InstallPromptLike {
  readonly prompt: () => Promise<void>;
  readonly userChoice?: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallClient {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  readonly displayModeStandalone: boolean;
  readonly navigatorStandalone: boolean;
}

export type InstallOfferKind = 'hidden' | 'ios' | 'prompt';

type PromptHost = {
  addEventListener(type: 'beforeinstallprompt', listener: (event: Event) => void): void;
  removeEventListener(type: 'beforeinstallprompt', listener: (event: Event) => void): void;
};

/** iPhone, iPad, and iPadOS Safari. Other iOS browsers cannot add a home-screen icon. */
export function isIosSafari(client: Pick<InstallClient, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  const ua = client.userAgent;
  const touchMac = client.platform === 'MacIntel' && client.maxTouchPoints > 1;
  const iosDevice = /iPad|iPhone|iPod/.test(ua) || touchMac;
  if (!iosDevice) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\/|Chrome|Chromium|Android/.test(ua)) return false;
  return /Safari/.test(ua) || touchMac;
}

export function isRunningStandalone(
  client: Pick<InstallClient, 'displayModeStandalone' | 'navigatorStandalone'>,
): boolean {
  return client.displayModeStandalone || client.navigatorStandalone;
}

export function installOffer(options: {
  readonly standalone: boolean;
  readonly iosSafari: boolean;
  readonly canPrompt: boolean;
}): InstallOfferKind {
  if (options.standalone) return 'hidden';
  if (options.canPrompt) return 'prompt';
  if (options.iosSafari) return 'ios';
  return 'hidden';
}

export function readInstallClient(): InstallClient {
  if (typeof navigator === 'undefined') {
    return {
      userAgent: '',
      platform: '',
      maxTouchPoints: 0,
      displayModeStandalone: false,
      navigatorStandalone: false,
    };
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: navigator.userAgent ?? '',
    platform: navigator.platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    displayModeStandalone:
      typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
    navigatorStandalone: nav.standalone === true,
  };
}

export function listenForInstallPrompt(
  host: PromptHost,
  onPrompt: (event: InstallPromptLike) => void,
): () => void {
  const listener = (event: Event) => {
    const candidate = event as Event & Partial<InstallPromptLike>;
    if (typeof candidate.prompt !== 'function') return;
    event.preventDefault();
    const prompt = candidate.prompt;
    onPrompt({
      prompt: () => prompt.call(event),
      userChoice: candidate.userChoice,
    });
  };
  host.addEventListener('beforeinstallprompt', listener);
  return () => host.removeEventListener('beforeinstallprompt', listener);
}

export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unknown' | 'failed';

export async function runInstallPrompt(event: InstallPromptLike): Promise<InstallPromptOutcome> {
  try {
    await event.prompt();
  } catch {
    return 'failed';
  }
  try {
    const choice = await event.userChoice;
    if (choice?.outcome === 'accepted' || choice?.outcome === 'dismissed') return choice.outcome;
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

/** A failed `prompt()` leaves the stored event in place so the row can be tried again. */
export function storedPromptAfter<T>(current: T, outcome: InstallPromptOutcome): T | null {
  return outcome === 'failed' ? current : null;
}
