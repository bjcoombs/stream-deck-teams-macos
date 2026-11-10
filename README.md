# Teams Meeting Controls for Stream Deck

Control a Microsoft Teams meeting from your Stream Deck on macOS: mute or unmute,
hold to talk, toggle the camera or background blur, raise or lower your hand,
leave the call, and send Like, Love, Applause, Laugh, or Surprise reactions.

The plugin uses macOS Accessibility. It needs no Teams credentials, network API,
or separate companion application.

## Requirements

- macOS 13 or newer, with an Apple silicon Mac for the current packaged build
- Stream Deck 7.1 or newer
- Microsoft Teams desktop (`com.microsoft.teams2`)

## Installation

1. Keep Stream Deck open and double-click the `.streamDeckPlugin` package.
2. Accept the installation prompt, then find **Teams Meeting Controls** and add
   the actions you want to your profile.
3. Join a test meeting and try a control. If macOS requests Accessibility access,
   enable the entry it presents under **System Settings > Privacy & Security >
   Accessibility**, then quit and reopen Stream Deck.

To build the package from source:

```sh
cd teams-reactions
npm ci
npm test
npm run pack
```

The package is written to
`teams-reactions/release/com.laurens-bolle.teams-reactions.streamDeckPlugin`.
See [Development](docs/development.md) for build requirements and validation.

For updates, install a package with a higher version. **Existing keys update
without remapping.** A same-version installer can be rejected as already installed.
See [Installation and troubleshooting](docs/troubleshooting.md) for reloads,
permission issues, and update verification. Domain terms are defined in
[CONTEXT.md](CONTEXT.md); contributor and agent rules are in [AGENTS.md](AGENTS.md);
lessons learned are in [docs/retros](docs/retros/README.md).

## Using the controls

Mute, Push to Talk, camera, background blur, and hand keys show the state
reported by Teams. Unknown or unavailable
states have distinct icons. A green check confirms the requested state, or that
Accessibility accepted a reaction. A yellow alert means the control is unavailable,
ambiguous, busy, or failed.

- The **Reaction** key sends Like, Love, Applause, Laugh, or Surprised. Choose
  the reaction under **Emoji Reactions** in the key settings; the key image
  follows the choice. New keys default to Like.
- Tap a reaction key to send once.
- Hold it to repeat at 7 attempts per second, starting after about 300 ms.
- Release to stop. Each hold is limited to five seconds, including picker setup.
- Reactions in Multi Actions send once. Only one Teams operation runs at a time.
- Hold **Push to Talk** to unmute a muted microphone; release to mute it again.
  If the microphone was already unmuted, the key changes nothing. Release,
  removing the key, disconnecting the device, and system wake all mute again.
  Push to Talk is refused in Multi Actions.
- **Background Blur** turns Teams standard blur on or off. Teams shows the
  blur state only inside its video effects panel, so each press briefly opens
  that panel, switches the effect and closes it again. The key shows the last
  state it set and a question mark until the first press in a meeting.
- Hold **Leave Call** for 1.5 seconds to leave. The key turns red while armed;
  releasing early cancels with a yellow alert. Leave is refused in Multi Actions.

Version `0.2.0.18` replaces the five separate reaction actions with the single
**Reaction** action. The old Like, Love, Applause, Laugh, and Surprise actions
are hidden from the action list but stay installed, so keys already on a profile
keep working unchanged. To move one to the new action, add a **Reaction** key and
choose the same reaction.

Reaction acceptance does not prove delivery to another participant. Test **Leave
Call**, **Push to Talk**, and **Background Blur** in a disposable meeting before
relying on them; neither new key has been tested live yet.

## Status

Version `0.2.0.10` adds bounded recovery for stale reaction buttons and forced
timeouts for unresponsive helpers. It retains strict reaction picker matching,
the persistent native helper for responsive microphone and camera controls,
and the Accessibility hash collision fix.
Live checks confirmed microphone and camera changes and a reaction tap with Teams
in the background; earlier helper checks confirmed both hand commands.

Leave safety, minimized/compact and multiple meeting windows, extended reaction
holds on this build, and delivery to another participant still need qualification.
See the [testing checklist and results](docs/testing/teams-call-controls.md) for
measurements and the full list of verified and unverified cases.

## Documentation

- [Development](docs/development.md): builds, packaging, tests, helper commands, and shortcut experiments
- [Architecture](docs/architecture.md): helper lifecycle, control discovery, reaction sessions, and protocol
- [Installation and troubleshooting](docs/troubleshooting.md): permissions, reloads, and update verification
- [Design research](docs/research/teams-call-controls.md): alternatives and technical decisions
- [Teams companion app research](docs/research/teams-app-companion.md): whether a Teams Store app could expose meeting controls to Stream Deck
