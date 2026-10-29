# Live score sync

Two phones can score the same match. A phone applies a point on its own screen immediately and sends it when the socket is open. If the socket is down, the point stays in a queue of at most 64. This note is the rule for what happens when that queue meets the match the server already has.

## What a score event carries

A score event is `game/increment`, `game/decrement`, `set/select`, `match/end`, or `match/resume`. The message is:

```json
{
  "type": "event",
  "eventId": "…uuid…",
  "event": { "type": "game/increment", "team": "b", "at": 1700000000000 },
  "claim": {
    "baseRevision": 5,
    "before": { "sets": [{ "a": 4, "b": 1 }, { "a": 0, "b": 0 }, { "a": 0, "b": 0 }], "activeSet": 0, "ended": false },
    "after": { "sets": [{ "a": 4, "b": 2 }, { "a": 0, "b": 0 }, { "a": 0, "b": 0 }], "activeSet": 0, "ended": false }
  }
}
```

`before` is the board the phone scored from. `after` is the board that point produces, including which set is open and whether the match is ended. `baseRevision` is the revision the phone had for `before`. The server checks that it is an integer from 0 through 10,000,000. The board decides. A matching revision is not required, because a phone that was offline numbers its own later points, and a rename moves the revision without moving the score.

The server checks the shape before it stores anything. The only keys are the ones above. Each set score has to be a possible padel score (the same rule as the court: 6 with a two-game lead, 7–5, or 7–6). `after` must be what this event actually does to `before`. Anything else is `not_applied` and is not stored. The same event id is still stored only once, and a repeat of that id does not look at the claim again.

A phone on 2.2.3 sends no claim. The server refuses that score. Serve changes and team renames are not score events.

## Reconnect

The server sends the current log in the snapshot. The phone compares its queue with that board before it sends the queue again.

The score events in the queue are one chain: each `after` is the next event’s `before`.

- The server board is already the last `after`. Every score event in the queue is dropped. Nothing is sent. This is the case of two phones counting the same points. 4:1, then both add two games for the same team, ends at 4:3. It does not become 4:5.
- The server board is some earlier `after` in the chain, and the next event still starts from that board. The phone sends only the tail. Three offline games against two already stored keeps the third. A set both phones already closed, followed by one more game on the offline phone, keeps that game.
- The server board is the first `before`. The queue is still the next points. It is sent.
- The server board is not on the chain. The phones diverged. The phone sends nothing and shows “The other phone already changed this match. This phone is using that score.”

A rename or a serve in the queue is still sent when the score chain matches, because it does not change the board. A diverged chain drops those too. The server’s log is loaded in their place.

The server repeats the check on each event it receives, so a phone that sends the whole queue anyway cannot double-count:

- `after` is already the stored board: acknowledge `duplicate` and `reconciled: "already"`. Do not insert. Do not tell the other phones. Their screens must not add the point.
- `before` is the stored board: insert the point once and broadcast it.
- Neither: `score_kept`. Do not insert. The phone drops the rest of its queue, reconnects, and loads the server match.

A point the server refuses with `not_applied` (a bad claim, or a point the game rules reject) is removed on that phone only. `score_kept` is not that. It means the match moved, and this phone now shows the server’s match.

## Conflict

A conflict is any queued chain whose boards are not the server board and do not start at the server board. The two usual cases:

- The phones added games for different teams from the same score.
- One phone took a game back and the other added a different game.

The server board wins. The client replaces its log with the snapshot and drops the stale events. The dropped events are not written into the match history. The history is the server log, in order, with who made each change. Adding a stored note for every rejected event would let a client fill the 500-event cap. The fixed sentence on the phone is the note the players see.

## Limits

The phone queues at most 64 unsent events. A further tap is not applied and the court says to wait. The server still accepts at most 500 stored events, about 8 KB per socket message, and 10 messages a second on one socket. An event that is already counted, or that conflicts, does not write a row.
