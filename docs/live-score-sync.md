# Live score sync

Two phones can score the same match. A point is applied on the phone that tapped it, and sent when the socket is open. If the socket is down, the point stays in a queue of at most 64.

## Which signal decides a merge

Two designs were compared.

**Clocks.** Each phone sends its time. The server measures the offset and treats two reports of the same game within about a minute as one point. A padel game does take longer than a minute, so the window is plausible. It is still the wrong primary key. A phone clock can jump, two different games can be entered inside the window, and the same game can be entered late. The offset is useful for showing a time. It is a poor way to decide whether a point already exists.

**Parent chain.** Every score event names the server event it was built on, the way a commit names its parent. The server log is a line of those parents, ordered by the server clock (`at` is when the server accepted the event). That chain is unambiguous:

- The same event id is already stored.
- The parent is the current head, and the board before the point is that head. The point is new. Append it.
- The parent is an earlier event, and the phone's points repeat what the server already did from that parent. Those points are the same ones. Do not append them.
- The parent is an earlier event, and the phone also has points the server does not. Append those points on top of the server's later points. A minus that only the offline phone made is one of those points.
- A plus and a later minus of the same team in the same set, on the offline phone, cancel before this comparison. The minus was undoing that phone's own plus. If the plus was the same point the other phone already stored, the minus must not subtract it. So an offline +1/−1 against an online +1 stays at the online score (4:1 then one game is 4:2, not 4:1). An offline +2/−1 against an online +2 stays at 4:3.
- The parent id is missing from the server log, or the queued events do not form one chain. That is the only ambiguous case. Nothing is added until someone taps **Add them**.

The phone's clock and the offset are not read by this decision. Server timestamps order the log. They do not decide that two branches are the same point.

## Patrick's 4:3 case

The score is 4:1. Phone A is offline and records two games for team B (4:2, then 4:3). Phone B records the same two games online. A's events name the same parent as B's, and the boards match. Both of A's points are the ones already stored. The match stays **4:3**. It does not become 4:5.

If A recorded three games and B recorded two, the first two match and the third is appended. The match becomes 4:4.

If A recorded games for team B and B recorded a game for team A from the same parent, both are kept. Neither phone's points are dropped.

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

History shows `capturedAt` when it is present, otherwise `at`, in the timezone of the phone that is reading it. An offline point keeps the time it was tapped, not the time it was uploaded. The offset is not used to merge.

## Ambiguous chains

If the parent is not in the server log, or the queue is not one chain, or the queue is longer than 64, nothing is merged. The court lists those points and shows **Add them**. That button appends them, once, on top of the current server score. It does not try to guess. Sixty-four is the most the phone will queue; a further tap is not applied. The server still stops at 500 stored events.

A point the server marks `duplicate` with `reconciled: "already"` is not broadcast. Another phone must not add it a second time. The phone that receives `duplicate: true` does not apply it again.

A tap made while an earlier score is still waiting for an answer stays on the phone and is sent after that answer. It is not dropped between reconnect and the acknowledgement.
