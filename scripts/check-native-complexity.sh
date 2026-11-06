#!/usr/bin/env bash
# Fails when any Objective-C function exceeds its cyclomatic complexity ceiling.
# Ceilings sit at today's worst case and may only move down (see AGENTS.md).
set -euo pipefail

LIZARD_SPEC="lizard==1.23.0"
HELPER_CEILING=15   # issue #7 target; worst today is MarkMeetingReactionPicker and StateControlNodes at 11
TESTS_CEILING=35    # main in tests/LauncherScoringTests.m

root=$(cd "$(dirname "$0")/.." && pwd)
pipx run --spec "$LIZARD_SPEC" lizard -l objectivec -C "$HELPER_CEILING" -w "$root/TeamsReactionPOC.m"
pipx run --spec "$LIZARD_SPEC" lizard -l objectivec -C "$TESTS_CEILING" -w "$root/tests/LauncherScoringTests.m"
echo "Native complexity within ceilings (helper $HELPER_CEILING, tests $TESTS_CEILING)."
