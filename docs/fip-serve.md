# Serve cues and the FIP rulebook

Checked 2026-10-30.

Source: International Padel Federation, *Rules of Padel*, review of application 1 January 2026. The PDF is the December 2025 file on the federation site (page title “Rules of Padel - 18 Dec_REV”):

https://padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf

The same citation is in `packages/core/src/rules.ts` (`FIP_SERVE_SOURCE`). The court does not invent a rule when that PDF does not state one.

## What the court says

- **0–0 and no serving team.** “Please choose the serving team.” Rule 4: the toss decides who serves or receives first, or which side, and the other pair takes the remaining choice. This counter does not run a coin toss. It asks the players to mark the serving team. The two balls pulse until one is chosen. `prefers-reduced-motion` turns the pulse off. The sentence stays.
- **6–6.** Tie-break point 3: the player whose turn it is serves one point from the right. Then each player serves two points in a row, in the service order. Those next two points are served from the left. The sentence does not say the second of those points is from the right. Rule 5.2: the players change ends every 6 points. The court says: “Team A player 1 serves 1 point, from the right. Then each player serves 2 points in a row. The next 2 points are from the left. Change ends every 6 points.” The name is the server already shown for that game. This counter still scores the tie-break as one game. It does not move the server every two points. After twelve games of one rotation, that server is the player who opened the set (A1 if A served first, B1 if B served first). A court that is already on player 2 names player 2.
- **Set won 7–6, next set still 0–0, server not chosen.** Tie-break point 5: the next set is started by the pair that did not begin serving in the tie-break. Rule 6.8: before each set, that pair chooses which player serves first. The hint names that pair and says they choose the player. It goes away when a player is chosen.

## Not stated, so not shown

- A set that ends 6–4 or 7–5 has no sentence like tie-break point 5. The court does not claim that “the other team” serves. Rule 6.8 still lets the pair choose a player, but only when this counter already knows which pair that is.
- The November 2024 PDF (`https://www.padelfip.com/wp-content/uploads/2024/11/FIP-Rules-of-Padel.pdf`) has a case: the player who began the set serves the tie-break, except Rule 6.9. That case is not in the December 2025 PDF used here. At 6–6 with the normal rotation, that player and “whose turn it is” are the same person. The hint names the server this court is already showing for that game.
- Tie-break point 3 says the next two points are “serving from the left”. It does not give a side for every later point, and it does not say those two points are first from the left and then from the right. A shorter line with that right-side serve was checked against the December 2025 PDF and not used. Rule 6.5 says the serve side alternates in an ordinary game. The hint repeats the rulebook’s “from the left” and does not add a side for the points after those two.
- “The player of the pair who did not begin serving” could be read as one named player. Rule 6.8 says the pair may choose which player serves at the start of the set. The hint uses both sentences: the pair is fixed, the player is their choice.
