# Changelog

## 2.2.4

- A live point now says which score it came from and which score it produces. When a phone reconnects, a point whose result is already on the match is not counted again. Two phones that both move 4:1 to 4:3 while one of them is offline stay at 4:3.
- If one phone scored further than the other, only the extra points are added. A correction, a set change, or a real disagreement is handled on purpose: the match on the server stays as it is when the two phones diverged, and that phone shows “The other phone already changed this match. This phone is using that score.” The history of the match is the server’s list of points. A point that was not applied is not written into that list.
- A score that is the wrong shape, the wrong type, or not a possible padel score is refused. The same event id is still stored only once.

## 2.2.3

- While a match is running, the screen stays on. Ending the match, or leaving the app, lets the phone sleep again. Coming back asks for the screen lock again, and so does the next tap on the court if the lock was dropped.
- iPhone Safari, including the home-screen app on older iOS, plays a tiny silent video from this app when the screen lock is missing or refused. A press, a release, or a click starts it. The home-screen app receives that clip as a byte range (206). The clip stops when the match ends or the app is in the background.

## 2.2.2

- iPhone Safari can join a live match from the in-app camera. The scanner reads a centred square of about 480-720 pixels instead of the full camera frame, and it does not start a second decode while one is still running.
- A join link is accepted when this page was opened as `index.html`, with a trailing slash, or with a query such as `?source=pwa`. The token still has to be in the fragment of a same-origin link for `/PadelCounterV2`.
- If the camera starts but the picture cannot play, Join match says so. A QR that is not a join link shows “That code did not work.” A recognised join link closes the dialog and joins the same way as a typed code.
- The camera stops after 90 seconds and says “Camera stopped. Tap Use camera to try again.” One frame shares about 80 ms, and a decode that does not finish does not leave the scanner stuck.
