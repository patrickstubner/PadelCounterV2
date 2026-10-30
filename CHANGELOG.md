# Changelog

## 2.2.5

- Join match opens the camera across the whole screen. Close and Enter code sit on top of the picture.
- An iPhone can read a code shown on another phone. The scan keeps trying contrast, glare, and a smaller crop, and it does not need the browser's barcode detector.
- As soon as a code is read, the camera turns off and the match score is shown.
- The phone that shows the code draws it large, with a white margin, and asks for full brightness.

## 2.2.4

- A live point names the server point it was scored on, and the score before and after. Two phones that both move 4:1 to 4:3 stay at 4:3. Points only one phone recorded are added, including a correction. An offline plus and minus of the same game do not undo the other phone's point. History shows when the point was tapped, in this phone's local time.
- If one phone scored further, only the extra points are added. If the phones scored for different teams, both sides are kept. The court asks before adding points only when it cannot tell which event they follow. A score that is the wrong shape is refused. The same event id is stored only once.
- Taking turns online keeps every point. A rename or a serve change does not make the same point count twice. Points that could not be matched are listed as such, and counting them again can raise the score a second time. A point that is already in the score is not offered again.
- Two phones that tap different teams as a set ends show the same score. The correction is only the new events, and a long one is not repeated every tap. After the match ends, only a phone that already joined can open it.
- Two phones that tap the same team at the same time record one point, and each phone shows that score. Points from three or four phones are counted once each, in any order. Ending the match shows the server's final score. A new code disconnects phones that joined with the old one.

## 2.2.3

- While a match is running, the screen stays on. Ending the match, or leaving the app, lets the phone sleep again. Coming back asks for the screen lock again, and so does the next tap on the court if the lock was dropped.
- iPhone Safari, including the home-screen app on older iOS, plays a tiny silent video from this app when the screen lock is missing or refused. A press, a release, or a click starts it. The home-screen app receives that clip as a byte range (206). The clip stops when the match ends or the app is in the background.

## 2.2.2

- iPhone Safari can join a live match from the in-app camera. The scanner reads a centred square of about 480-720 pixels instead of the full camera frame, and it does not start a second decode while one is still running.
- A join link is accepted when this page was opened as `index.html`, with a trailing slash, or with a query such as `?source=pwa`. The token still has to be in the fragment of a same-origin link for `/PadelCounterV2`.
- If the camera starts but the picture cannot play, Join match says so. A QR that is not a join link shows “That code did not work.” A recognised join link closes the dialog and joins the same way as a typed code.
- The camera stops after 90 seconds and says “Camera stopped. Tap Use camera to try again.” One frame shares about 80 ms, and a decode that does not finish does not leave the scanner stuck.
