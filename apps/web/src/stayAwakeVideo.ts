/** Same-origin silent clip. Served from this app, never from a third party. */
export const STAY_AWAKE_FILE = 'stay-awake.mp4';

export interface StayAwakeVideoElement {
  prepare(): void;
  play(): Promise<void>;
  pause(): void;
  destroy(): void;
}

/**
 * NoSleep-style fallback for browsers with no working Screen Wake Lock
 * (older iOS, and the home-screen app before 18.4).
 * The element stays in the layout at 1px. Taking it out of the layout makes iOS stop the clip.
 */
export function createStayAwakeVideo(src: string): StayAwakeVideoElement {
  let video: HTMLVideoElement | null = null;
  let keepAlive = false;

  const ensure = (): HTMLVideoElement => {
    if (video) return video;
    const node = document.createElement('video');
    node.muted = true;
    node.defaultMuted = true;
    node.loop = true;
    node.playsInline = true;
    node.autoplay = false;
    node.controls = false;
    node.preload = 'auto';
    node.disablePictureInPicture = true;
    node.disableRemotePlayback = true;
    node.tabIndex = -1;
    node.setAttribute('muted', '');
    node.setAttribute('loop', '');
    node.setAttribute('playsinline', '');
    node.setAttribute('webkit-playsinline', 'true');
    node.setAttribute('aria-hidden', 'true');
    node.width = 1;
    node.height = 1;
    const style = node.style;
    style.position = 'fixed';
    style.width = '1px';
    style.height = '1px';
    style.opacity = '0';
    style.pointerEvents = 'none';
    style.inset = '0 auto auto 0';
    node.src = src;
    node.addEventListener('ended', () => {
      if (!keepAlive) return;
      void Promise.resolve(node.play()).catch(() => undefined);
    });
    (document.body ?? document.documentElement).append(node);
    video = node;
    return node;
  };

  return {
    prepare(): void {
      ensure();
    },
    play(): Promise<void> {
      const node = ensure();
      keepAlive = true;
      try {
        return Promise.resolve(node.play());
      } catch (error) {
        keepAlive = false;
        return Promise.reject(error instanceof Error ? error : new Error('playback failed'));
      }
    },
    pause(): void {
      keepAlive = false;
      video?.pause();
    },
    destroy(): void {
      keepAlive = false;
      const node = video;
      video = null;
      if (!node) return;
      node.pause();
      node.removeAttribute('src');
      node.load();
      node.remove();
    },
  };
}
