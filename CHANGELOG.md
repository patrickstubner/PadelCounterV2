# Changelog

## 2.2.9

- Take phones follows every phone that is still in the match. The other phones are not asked. They show “New match” and join on their own. A phone that is offline follows when it reconnects, while its code is still valid. Only the phone that started the match can do this.
- History can continue a match that ended before a winner, and a won match that still has a set left (2–0 in a best of 3). A match with all three sets played stays finished. The app asks first and keeps the match on the court in History. This phone plays on alone. Phones still in a live match stay there.
- On Android, the tap happens as the finger goes down. Scrolling or letting go does not tap twice. iPhone still uses the system switch tick on the click that counts the point.
- The court still opens when this phone blocks storage.

## 2.2.8

- Plus, minus, the serve ball, and changing the set give a short tap. Android vibrates for a moment. iPhone uses the system switch tick. Older phones stay quiet. Haptic feedback in the menu turns it off, and that choice stays on this phone.

## 2.2.7

- The top bar shows a phone icon before the number of connected phones.
- Connect and Join match close with the X or a tap outside. The extra Close button is gone. The buttons line up in portrait and in landscape.
- Send code shares a link to this app. The join code is only after the #, for example `https://patrickstubner.github.io/PadelCounterV2/#join=K7M4-2QAB`. Opening that link asks before it joins, including from Safari on an iPhone, and then removes the code from the address bar. A match already on this phone is kept in History. If the phone cannot share, the link is copied.
- A real win plays a short crowd clip stored in the app. Ending the match early still does not play it. Victory sound on or off is unchanged.

## 2.2.6

- Connect is one menu item. Show QR code connects another player, including a code to type. Scan QR code joins. Any phone already in the match can show the same code. The match still stops at 4 phones.
- While a match is live, the top bar shows how many phones are connected. Tap the number to see each phone: since when, online or last seen, a coarse device type, and “This device” on this phone.
- New match, while other phones are connected, asks whether to take them along. Yes moves those phones into the new match without a new scan. A phone that is offline joins when it reconnects, while its code is still valid. No starts the new match on this phone only.
- End match celebrates a winner only when a team has won two sets. Ending early shows who is leading. When the sets are level, the games decide, so 5–3 is “Team A leading”. “Draw” is only when the sets and the games are both level. There is no animation and no fanfare. History does not mark a winner for that match.
- A phone that is asked to move into a new match can accept or decline. The question names who started it. Only a phone that has already joined can start that move, and only three times for that phone. Decline stays on the current match. New code leaves the phone that asked on the court, and one guest phone cannot use up the host’s new code. A device id is 128 random bits. An id saved from an older version keeps its seat. A scan that never connects does not block the next phone.

## 2.2.5

- Join match opens the camera across the whole screen. Close and Enter code sit on top of the picture.
- An iPhone can read a code shown on another phone. The scan keeps trying contrast, glare, and a smaller crop, and it does not need the browser's barcode detector.
- As soon as a code is read, the camera turns off and the match score is shown.
- The phone that shows the code draws it large, with a white margin, and asks for full brightness.
- A code at the top or bottom of the picture is read, and a white frame shows the area. The scan rests between tries, and it pauses while Enter code is open.
- If the camera is blocked, the page asks you to allow it in Settings and does not ask again.

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
