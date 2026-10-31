# Changelog

## 2.3.6

- Minus puts the server back when it takes away the last game. At 6–6 the note names the server. Plus to 7–6 asks the other team who serves. Minus returns to 6–6 and that same server, including a step back into the previous set. Both phones of a live match show that same server. Minus on an earlier game, while a later game stays, keeps the usual serve step. A later Minus does not put back the server from before that earlier game.
- A serve chosen after a game is dropped when Minus takes that game back. The server is again whoever it was before that game.

## 2.3.5

- The serve ball is a yellow-green padel ball with a curved seam.
- When a ball lights up, the glow is a little stronger. The ring around it shrinks slightly, then grows, in time with that glow. When the phone asks for less motion, the glow stays bright and still.

## 2.3.4

- At 6–6 the last sentence of the note is “Teams switch sides every 6 points.”
- On a wide window the serve ball stays tappable. The score digits no longer cover it. In landscape the page does not scroll, and the digits stay whole.
- Installing the app uses black, the same colour as a court played alone.
- The serve balls are a little larger. Until a serving team is chosen, both balls show a spotlight that grows and shrinks. After a tie-break, and whenever one team still has to choose player 1 or player 2, only that team’s ball glows, and the glow is stronger, until the player is chosen. When the phone asks for less motion, the glow stays bright and still.

## 2.3.3

- At 6–6 the note names the player whose turn it is. They serve 1 point from the right. Then each player serves 2 points in a row, starting from the left. The players change ends every 6 points. The FIP tie-break says those next two points are from the left, and it does not say the second one is from the right, so the note does not add that. After a normal rotation the named player is the one who opened the set. If the court is already showing player 2, the note names player 2.
- In landscape the rules leave the bottom of the court, as they do in portrait. The version stays at the bottom of the menu.
- In landscape the menu button is at the top right. Connect sits immediately to its left, in the same shape as the menu button. While phones are connected, the phone button sits there instead, and Connect stays in the menu.
- On iPhone the status bar and the home indicator use the same colour as the header. A live match is blue. Playing alone is black. Offline is the same dark red as the header. The colour changes with the connection.

## 2.3.2

- A phone that is removed sees “You were removed from this match. Ask the others for a new code.” That message is final. Joining again with the current code, from the link or the short code, says “This phone was removed from this match. Ask the others for a new code.” A phone that was offline when it was removed hears the same sentence when it connects with its own token. A wrong code, an expired code, another phone, and a code after New code stay the same as before.
- In portrait the current-set digit grows to the free space on that phone. Round digits stay inside the column, and the page does not scroll. Landscape is unchanged.
- The buttons in the top bar use the same slightly rounded corners as the menu button, in portrait and in landscape.
- Connect offers “Share my match (create code)” and “Join another match (scan code)”. Share opens the QR straight away. Join opens the camera on that tap, with the code field on the same screen. If the camera is blocked, the code can still be typed. A link still asks before it joins.

## 2.3.1

- In portrait the large score shows the whole digit. Round numbers such as 0, 6, 8, and 9 are not cut off at the top or the bottom. Landscape is unchanged.
- Remove asks first. This phone cannot rejoin with the current code. Tap New code to let it join again.
- The home-screen icon, the maskable icons, and the favicon show a large V2.
- Plus stops on a set that is already finished, and when the match is already won, including the empty third set. That covers 6–0, 6–4, 7–5, and 7–6, for both teams, and a match that has ended. Minus still takes a game back. Plus works again when that set is no longer finished. A saved log still replays a plus that was stored earlier. If the server refuses a point this phone already counted, the court says that point was not added.

## 2.3.0

- The phone button in the top bar is a rounded rectangle, the same shape as the menu button.
- Connected phones are two lines. A green dot means connected and a red-orange dot means not. Remove asks first. That phone is removed. Others can still join with this code until you tap New code. You cannot remove this phone. A guest cannot remove the phone that started the match, and does not see that button. The starter can remove the others. Too many removals wait.
- In portrait the rules and the version leave the bottom of the court, so the score uses the height. The version is at the bottom of the menu, larger.
- Share link still sends the link. Copy code copies only the code, then says Copied.
- At 0–0 the court asks you to choose the serving team, and the two balls pulse. At 6–6 it explains the tie-break. After 7–6 it says who serves the next set. The note goes away once that choice is made. The wording follows the FIP Rules of Padel, review of application 1 January 2026 (`docs/fip-serve.md`).
- A mouse release outside plus, minus, serve, or a set does not count. Dragging a finger away no longer swallows the next keyboard tick.
- Continue does not show the win celebration again. Points entered offline before a follow are kept in History, with a short note.
- Take phones is offered when another phone has joined, even if that phone is offline. Carry is not counted in the shared per-address limit.
- Removing a phone revokes that credential only for this room’s id, not for a match id stored in the score log.
- Leave live match revokes this phone’s own credential. The shared code stays valid, and the other phones stay connected.
- Ending a match still turns the code off when the room’s name is missing. The room keeps its id from when it was created. If that id is missing too, the ending is not saved, so a retry can still turn the code off.

## 2.2.10

- Ending a match invalidates its join code, including a match that was started by taking the other phones along. Asking for a new code does the same. Leaving the match on this phone does not.

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
