# 2026-11-10 Keys stayed inactive during a meeting

## What happened

Version `0.2.0.20` greyed every key and ignored presses while Teams status showed
no meeting. In the first live use, the keys went inactive between calls and stayed
inactive after the user joined a new call. A one-shot `status` run at the same
time reported `meetingActive: true` with known microphone and camera states, but
the plugin log showed about 30 "Ignored a key press because no Teams meeting is
active" lines over several minutes.

The persistent helper publishes a state event only when its snapshot differs from
the last one it published. The reads that made the keys inactive came from
one-shot `status` refreshes, not from that event stream, so the helper's last
published snapshot could already equal the in-meeting state. Once inactive, the
plugin had no read of its own that could bring the keys back, and every press was
dropped on stale state.

A second false negative was found in the same session. While the Teams Share
content picker is open, it hides the meeting toolbar, and `status` reports
`meetingActive: false` with every control unavailable. A user who took more than
two seconds to choose a screen would have seen every key grey out.

## What would have caught it

- A unit test that drives the decision to inactive and then delivers no further
  pushes. The original tests always supplied the next read, which hid the missing
  recovery path.
- A rule that a state which disables keys must have its own way out, and must not
  depend on an event source that might stay silent.
- A live checklist pass of the Teams panels that cover the toolbar (video
  effects, share, device settings) before the inactive state shipped. The
  effects panel was known and handled; the share picker was not looked for.

## Enforcing change

- `teams-reactions/src/meeting-activity.ts` reads status every two seconds
  while keys are inactive and visible, until a read shows a meeting. A key-down
  while inactive reads status first and runs if that read shows a meeting.
  Regression tests in `teams-reactions/tests/meeting-activity.test.mjs`:
  "inactive keys recover from a recheck when Teams publishes nothing" and "an
  inactive press reads status and runs when it shows a meeting".
- `teams-reactions/tests/architecture.test.mjs` checks that Push to Talk and
  Leave cancel a press released during that status read. Without that check, a
  release that arrived during the read could leave the microphone unmuted or
  arm Leave with no hold.
- `TeamsReactionPOC.m` treats an open Share content dialogue as an active
  meeting; `tests/LauncherScoringTests.m` covers it.
- `docs/testing/teams-call-controls.md` adds live cases for joining a call
  while the keys are inactive, pressing a grey key during a meeting, and the
  share picker.
