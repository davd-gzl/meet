# Breakout rooms

A host can split a meeting into 2 to 10 smaller meetings, move everyone into the one they were assigned, and later bring everyone back.

## What a host does

1. In the meeting, the owner or an administrator opens the breakout panel, picks a number of rooms and assigns each participant to one of them, by hand or with a shuffle.
2. Open creates the rooms. Every assigned participant still in the meeting is moved to their room. Someone who joins the meeting later has no assignment and stays in it.
3. Close deletes the rooms, and everyone in them is sent back to the meeting they started in.

Only one split can be open in a meeting at a time, and a split being closed still counts as open. To change the assignments, close and open again.

## In a breakout room

Raise hand, rename, muting someone and starting subtitles are not adapted to breakout rooms yet. The browser holds only its pass to the main meeting, and each of them acts on the main meeting's LiveKit room with that pass: muting is refused there, since the caller is not in that room, and subtitles transcribe the main meeting instead.

The split also closes on its own when the meeting ends, that is when LiveKit reports the main meeting's room as finished. Hosts are never moved, so this happens once every host and everyone left in the meeting has gone.

## Enabling it

Set `BREAKOUT_ROOMS_ENABLED=True` on the backend. It is off by default. The frontend reads it from the config endpoint as `breakout_rooms.is_enabled`.

With the flag off, every breakout endpoint is off, close included: a caller it would otherwise accept gets 404. A split opened before the flag was turned off still closes when its meeting ends.

Nothing else is required: no worker, no scheduled task. The backend creates and deletes the rooms on LiveKit directly, and each call to LiveKit gives up after 5 seconds with a 503 the host can retry.

## What is stored

- A breakout session per split: the meeting, its state (`active`, `closing` or `closed`), who opened it, and when it closed.
- A breakout room per smaller meeting: its display name and the name of its LiveKit room, `breakout_<session id>_<index>`.
- An assignment per participant: the room, the participant's identity in the meeting, as their pass to it carries it, and their display name at the time. A participant asks for their breakout room with that pass, so only the holder of the identity gets the room assigned to it.

Closed sessions stay in the database. While a session is active, the main meeting's LiveKit metadata carries `{"breakout": {"session_id", "status": "active"}}`, which tells the browsers in it to move.

## Closing

Close first marks the session `closing`, then removes the `breakout` key from the meeting's metadata, then deletes the rooms, then marks it `closed`. While it is `closing`, joining answers 404, and opening a new split answers 409. If LiveKit fails part way, the close answers 503 and the session stays `closing`: the list still returns it, and closing it again runs the LiveKit calls again. A room LiveKit already dropped counts as deleted.

## Limits

- A pass to a breakout room is valid for 60 seconds. LiveKit recreates a deleted room when someone joins it, so a pass fetched just before Close can reopen that room until it expires.
- Nobody can leave their breakout room and come back to it, and the host does not visit rooms.
- After each move, the camera and microphone start as they were chosen before joining the meeting.
- The way back uses the main-meeting pass the page currently holds, which LiveKit keeps valid for 6 hours. If that pass is refused, a reload brings the participant back.
- There is no timer: a split stays open until the host closes it.
- A guest of a public meeting gets a new identity with every pass, so one who reloads the page while a split is open stays in the main meeting.
