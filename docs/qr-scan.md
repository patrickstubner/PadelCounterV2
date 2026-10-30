# Scanning a join QR

Join match reads a code with the rear camera. The picture fills the screen. Close and Enter code sit on top of it. As soon as a code is recognised, every camera track is stopped and the court shows the match score.

The phone that shows the code draws it large, black on white, with a four-module quiet zone inside the graphic, and asks for full brightness. The page cannot set the screen brightness. The screen-wake lock already keeps a running match from sleeping.

## What the automated tests cover

The fixtures in `apps/web/src/live/fixtures/` are photographs of a display, built by `apps/web/scripts/make-qr-fixtures.mjs` from the same kind of QR the host draws (error correction H, quiet zone). They are not pictures taken with a phone. Each one is a 640×480 frame with sensor noise:

| Fixture | What it imitates |
| --- | --- |
| `skewed.png` | The host phone held at a small angle |
| `blurred.png` | Focus that has not settled |
| `small.png` | The code occupies only the middle of the frame |
| `bright.png` | The screen blown out by auto exposure |
| `dark.png` | A dim screen |
| `glare.png` | A lamp reflection on the glass, plus a soft glow |

`readQr.fixtures.test.ts` decodes each file with `BarcodeDetector` removed, which is the iOS path. `joinScan.e2e.test.tsx` goes from a recognised code, to both camera tracks stopped, to the live score on the court. The camera is not opened until Use camera. Continuous focus is requested only when the track lists `focusMode`.

Regenerate the fixtures with:

```sh
node apps/web/scripts/make-qr-fixtures.mjs
```

## What only a real iPhone can show

These checks need a phone. CI does not have a camera, and it does not run WebKit.

1. **Home-screen app and Safari.** Add the site to the Home Screen and also try it in Safari. `BarcodeDetector` is missing or non-functional on iOS (WebKit bug 281848, including with the Shape Detection flag). The software decoder is the one that must hit. There is no native detect call to wait on.
2. **The preview fills the screen.** The picture goes edge to edge, including around the notch. Close and Enter code are on top of it. The old preview was a 16rem box inside the dialog. That is the window the field test could not use.
3. **The delivered resolution.** After Use camera, `videoWidth` and `videoHeight` on the element should be at least 720 on the short side when the phone can do it. The page asks for 1920×1080 ideal, then 1280×720, then any rear camera. iOS often ignores or briefly mis-sizes that request (WebKit bugs 176349, 259364, and 262618). A second open of the camera can shrink the preview. Confirm a fresh open still fills the screen and still decodes.
4. **iPhone scanning an Android screen.** On the Android phone, open Connect players, turn brightness all the way up, and hold the code flat. On the iPhone, Use camera. A code at a slight angle, with a reflection on the glass, should read within a couple of seconds. The camera light must go out immediately, and the match score must be the score from the other phone, not the empty court left behind the scanner.
5. **Android scanning the iPhone.** The other direction. The iPhone code is large and has a white margin. Android can use `BarcodeDetector` when it exists. Continuous focus is requested only there. iOS does not expose `focusMode`, so holding the iPhone about 15–25 cm away and keeping it still is the check, not a focus slider.
6. **Permission and leaving.** The permission prompt appears on Use camera, not when Join match opens. Switching away from the app stops the tracks. Coming back does not turn the camera on by itself. After 90 seconds the page says to tap Use camera again.
7. **Standalone playback.** The home-screen app must show the inline camera (`playsinline`). A video that opens fullscreen and leaves the page is a failure.

Do not print the token, the camera stream, or any secret while doing this.
