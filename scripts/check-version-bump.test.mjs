import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, isPluginPath } from "./check-version-bump.mjs";

test("compares numerically, not as strings", () => {
  assert.ok(compareVersions("0.2.0.9", "0.2.0.10") < 0);
  assert.ok(compareVersions("0.2.0.10", "0.2.0.9") > 0);
});

test("equal versions compare as 0", () => {
  assert.equal(compareVersions("0.2.0.10", "0.2.0.10"), 0);
});

test("earlier parts dominate later parts", () => {
  assert.ok(compareVersions("1.0.0.0", "0.9.9.99") > 0);
  assert.ok(compareVersions("0.3.0.0", "0.2.9.9") > 0);
});

for (const bad of ["", "1.2.3", "1.2.3.4.5", "1.2.3.x", "1.2.3.-1", "1.2.3.", "01.2.3.4", " 1.2.3.4", "1.2.3.4\n", 1234, null, undefined]) {
  test(`rejects malformed version ${JSON.stringify(bad)}`, () => {
    assert.throws(() => compareVersions(bad, "0.0.0.1"), /version/i);
    assert.throws(() => compareVersions("0.0.0.1", bad), /version/i);
  });
}

test("isPluginPath matches shipped files only", () => {
  for (const p of [
    "TeamsReactionPOC.m",
    "teams-reactions/src/actions/leave.ts",
    "teams-reactions/com.laurens-bolle.teams-reactions.sdPlugin/manifest.json",
    "teams-reactions/com.laurens-bolle.teams-reactions.sdPlugin/imgs/icon.png",
    "teams-reactions/package.json",
    "teams-reactions/package-lock.json",
  ]) assert.equal(isPluginPath(p), true, p);
  for (const p of ["README.md", "docs/x.md", ".github/workflows/ci.yml", "teams-reactions/tests/a.test.ts", "scripts/check-version-bump.mjs"]) {
    assert.equal(isPluginPath(p), false, p);
  }
});
