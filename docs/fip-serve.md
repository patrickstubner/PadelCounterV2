# Serve cues and the FIP rulebook

Checked 2026-10-30.

Source: International Padel Federation, *Rules of Padel*, review of application 1 January 2026. The PDF is the December 2025 file on the federation site (page title “Rules of Padel - 18 Dec_REV”):

https://padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf

The same citation is in `packages/core/src/rules.ts` (`FIP_SERVE_SOURCE`). The court does not invent a rule when that PDF does not state one.

## What the court says

- **0–0 and no serving team.** “Please choose the serving team.” Rule 4: the toss decides who serves or receives first, or which side, and the other pair takes the remaining choice. This counter does not run a coin toss. It asks the players to mark the serving team. The two balls pulse until one is chosen. `prefers-reduced-motion` turns the pulse off. The sentence stays.
- **6–6.** Tie-break point 3: the player whose turn it is serves one point from the right. The other team then serves two points, and the rule says those are served from the left. After that, two points each, in the same order. Rule 5.2: the players change ends every 6 points. This counter still scores the tie-break as one game. It does not move the server every two points.
- **Set won 7–6, next set still 0–0, server not chosen.** Tie-break point 5: the next set is started by the pair that did not begin serving in the tie-break. Rule 6.8: before each set, that pair chooses which player serves first. The hint names that pair and says they choose the player. It goes away when a player is chosen.

## Not stated, so not shown

- A set that ends 6–4 or 7–5 has no sentence like tie-break point 5. The court does not claim that “the other team” serves. Rule 6.8 still lets the pair choose a player, but only when this counter already knows which pair that is.
- The November 2024 PDF (`https://www.padelfip.com/wp-content/uploads/2024/11/FIP-Rules-of-Padel.pdf`) has a case: the player who began the set serves the tie-break, except Rule 6.9. That case is not in the December 2025 PDF used here. At 6–6 with the normal rotation, that player and “whose turn it is” are the same person. The hint names the server this court is already showing for that game.
- Tie-break point 3 says the next two points are “serving from the left”. It does not give a side for every later point. Rule 6.5 says the serve side alternates. The hint repeats the rulebook’s “from the left” and does not add a side for the points after those two.
- “The player of the pair who did not begin serving” could be read as one named player. Rule 6.8 says the pair may choose which player serves at the start of the set. The hint uses both sentences: the pair is fixed, the player is their choice.
