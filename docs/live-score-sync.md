# Live score sync

Two phones can score the same match. A point is applied on the phone that tapped it, and sent when the socket is open. If the socket is down, the point stays in a queue of at most 64.

## Which signal decides a merge

Two designs were compared.

**Clocks.** Each phone sends its time. The server measures the offset and treats two reports of the same game within about a minute as one point. A padel game does take longer than a minute, so the window is plausible. It is still the wrong primary key. A phone clock can jump, two different games can be entered inside the window, and the same game can be entered late. The offset is useful for showing a time. It is a poor way to decide whether a point already exists.

**Parent chain.** Every score event names the server event it was built on, the way a commit names its parent. The server log is a line of those parents, ordered by the server clock (`at` is when the server accepted the event). That chain is unambiguous:

- The same event id is already stored.
- The parent is the current head, and the board before the point is that head. The point is new. Append it.
- The parent is an earlier event. Every point since that event is compared as a group, not only with the first one. A point is the same when it is the same team and the same plus or minus. The same set is preferred. A set win on one phone does not make the other phone's point a second point. Order does not matter. Points the server does not have are appended, including a minus.
- A plus and a later minus of the same team in the same set, on the offline phone, cancel before this comparison. The minus was undoing that phone's own plus. If the plus was the same point the other phone already stored, the minus must not subtract it. So an offline +1/−1 against an online +1 stays at the online score (4:1 then one game is 4:2, not 4:1). An offline +2/−1 against an online +2 stays at 4:3.
- A rename or a change of server between the fork and a point is not a point. Matching skips it, so the point after it is still the same point.
- The parent id is missing from the server log, or the queued events do not form one chain. That is the only ambiguous case. Nothing is added until someone taps **Count them again**.

The phone's clock and the offset are not read by this decision. Server timestamps order the log. They do not decide that two branches are the same point.

## Patrick's 4:3 case

The score is 4:1. Phone A is offline and records two games for team B (4:2, then 4:3). Phone B records the same two games online. A's events name the same parent as B's, and the boards match. Both of A's points are the ones already stored. The match stays **4:3**. It does not become 4:5.

If A recorded three games and B recorded two, the first two match and the third is appended. The match becomes 4:4.

If A recorded games for team B and B recorded a game for team A from the same parent, both are kept. Neither phone's points are dropped.

Two phones that tap the same team on the same score, including at the same moment, record one point. The phone that already showed both reloads the server score when the server answers `already`. A phone that was offline for a moment and then taps the point the other phone already stored is the same case: the match stays at that score. Ten points split across a short offline gap can finish 5:4 rather than 5:5 when both phones tapped the same team from the same point in the chain. That is the other side of not counting one game twice.

Ending the match keeps the server score. A phone that still had its own points shows the ended server score when it reconnects. Those points are not added after the end.

A new code turns off the previous code. Phones that joined with it are disconnected and told the code is no longer valid. Showing the existing code does not create a new one.

## What a score event carries

```json
{
  "type": "event",
  "eventId": "…uuid…",
  "parentId": "…the event this point was scored on, or null…",
  "event": { "type": "game/increment", "team": "b", "at": 1700000000000 },
  "claim": {
    "baseRevision": 5,
    "before": { "sets": [{ "a": 4, "b": 1 }, { "a": 0, "b": 0 }, { "a": 0, "b": 0 }], "activeSet": 0, "ended": false },
    "after": { "sets": [{ "a": 4, "b": 2 }, { "a": 0, "b": 0 }, { "a": 0, "b": 0 }], "activeSet": 0, "ended": false }
  }
}
```

`parentId` is a lowercase UUID, a seed id such as `seed-3`, or null. Anything else is rejected. `before` and `after` are the three set scores, the open set, and whether the match has ended. `after` must be what the event actually does to `before`. A score outside a possible set, a wrong type, or an extra field is rejected and not stored.

Hello uses `protocol: 2`. A phone that still says `protocol: 1` is told to update. The socket closes.

Ending a match does not depend on the scoreboard matching. `match/end` is stored when the match is still open.

## Time is for History

On hello the phone sends `clientNow`. The server stores `serverNow - clientNow` for that socket, clamped to ±12 hours. A missing or nonsense clock stores an offset of 0. Twelve hours covers a timezone mistake. It does not accept a clock set to another year.

Each event's `at` on the wire is the phone's capture time. The server stores two instants:

- `at` is the server clock when the event was accepted. The one-day close and the log order use this.
- `capturedAt` is the capture time plus the offset, clamped so it is not more than five seconds in the future and not before the match was created.

History shows `capturedAt` when it is present, otherwise `at`, in the timezone of the phone that is reading it. An offline point keeps the time it was tapped, not the time it was uploaded. The offset is not used to merge. A point that was already on the phone when the match was created is a seed. Its display time is clamped to the server clock, so a future or ancient phone time is not stored.

## Ambiguous chains

If the parent is not in the server log, or the queue is not one chain, or the queue is longer than 64, nothing is merged. The court lists those points. The text says they could not be matched, and that adding them counts them again on top of the current score, because they might already be in the match. **Count them again** does that once. Sixty-four is the most the phone will queue; a further tap is not applied. The server still stops at 500 stored events.

While both phones are online, each phone sets its next parent to the latest point or rename from the other phone. A point sent with a stale parent is refused. The phone reloads the server log and sends that point again with the parent and the before/after board from the merge. A second refusal leaves the point on the list. Reconnecting does not clear that list.

A point the server marks `duplicate` with `reconciled: "already"` is not broadcast. Another phone must not add it a second time. The phone that receives `duplicate: true` does not apply it again.

A tap made while an earlier score is still waiting for an answer stays on the phone and is sent after that answer. It is not dropped between reconnect and the acknowledgement.
