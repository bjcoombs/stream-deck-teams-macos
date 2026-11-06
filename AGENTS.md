# Agent instructions

Use plain punctuation. No em-dashes in prose, comments, or documentation.

Read `README.md` before changing behavior or building. For control-selection or
reaction changes, follow `docs/testing/teams-call-controls.md` and report which
live cases remain unverified.

## Packaged plugin updates

1. Increase `Version` in
   `teams-reactions/com.laurens-bolle.teams-reactions.sdPlugin/manifest.json`
   above the installed version before packaging. Stream Deck can reject the same
   version as "already installed", leaving the old files in place.
2. Build, validate, and package using the README, then open the package and
   complete Stream Deck's installation prompt.
3. Verify the installed manifest version and compare installed `bin/plugin.js`
   and `bin/teams-reaction` with the rebuilt files. The installed bundle is under
   `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.laurens-bolle.teams-reactions.sdPlugin`.
4. Confirm a new plugin process started before reporting the update as loaded.
   Reinstalling or a full Stream Deck restart reloads replaced files; restarting
   alone cannot install files that the installer rejected.

## Commands

Run from `teams-reactions/` unless noted. CI runs the same sequence.

| Purpose | Command |
|---|---|
| Install dependencies without lifecycle scripts | `npm ci --ignore-scripts` |
| Full check: native tests, lint, unit tests with coverage gate, typecheck | `npm test` |
| Lint only | `npm run lint` |
| Build and package `release/com.laurens-bolle.teams-reactions.streamDeckPlugin` | `npm run pack` |
| Validate the plugin bundle | `npm run validate` |
| Build the standalone helper (repository root) | `./build.sh` |
| Objective-C complexity ceilings (repository root, needs `pipx`) | `./scripts/check-native-complexity.sh` |
| Dead code and unused dependencies | `npm run deadcode` |

`npm test` must pass before a change is pushed. Never weaken a gate to make it
pass: no new lint suppressions, no lowered coverage threshold, no raised size
ceiling in `tests/architecture.test.mjs`, `eslint.config.mjs` or
`scripts/check-native-complexity.sh` without a reason in the commit message.

## Layout

- `TeamsReactionPOC.m` - native Accessibility helper. Every Teams read and press happens here.
- `teams-reactions/src/helper-runner.ts` - the only module that launches the helper.
- `teams-reactions/src/actions/` - Stream Deck actions. They reach the helper only through `teams-services.ts`.
- `teams-reactions/src/hold-gate.ts` - hold-to-confirm gate used by Leave Call.
- `CONTEXT.md` - domain vocabulary. Use its terms.
- `docs/testing/teams-call-controls.md` - live test checklist and results.

## Logs

Plugin log lines go to Stream Deck's log. To read the latest:

```sh
rg 'teams-reactions' ~/Library/Logs/ElgatoStreamDeck/StreamDeck.log | tail -50
```

## Feedback loop

Work is tracked as GitHub issues on the fork with the `agent` label. After an
incident, a failed live test, or a pull request that needed more than two review
rounds, add an entry to `docs/retros/` and update this file, a test, or the
testing checklist so the lesson is enforced rather than remembered.
