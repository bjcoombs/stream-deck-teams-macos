# 2026-11-06 Leave Call fired on a single tap

## What happened

A security review of the fork found that the Leave Call key invoked Teams Leave on
key-down, with no confirmation, including from inside a Multi Action. The live
testing checklist recorded Leave as "Not run" for every case, so the behaviour had
never been exercised.

## What would have caught it

A rule that destructive actions need an explicit confirmation gesture, checked by
a unit test, before the action was wired to a key.

## Enforcing change

- `teams-reactions/src/hold-gate.ts` requires a 1.5 second hold; tests in
  `teams-reactions/tests/hold-gate.test.mjs`.
- `teams-reactions/tests/architecture.test.mjs` asserts that the Leave action
  uses the hold gate.
