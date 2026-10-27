/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly PUBLIC_API_URL: string;
}

declare module 'lottie-web/build/player/lottie_light' {
  interface LottieAnimation {
    destroy: () => void;
    goToAndStop: (value: number, isFrame?: boolean) => void;
  }

  interface LottieLight {
    loadAnimation: (params: {
      container: Element;
      renderer: 'svg';
      loop: boolean;
      autoplay: boolean;
      animationData: object;
      rendererSettings?: { preserveAspectRatio?: string };
    }) => LottieAnimation;
  }

  const lottie: LottieLight;
  export default lottie;
}
