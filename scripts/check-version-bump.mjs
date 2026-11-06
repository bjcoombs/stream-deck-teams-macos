// Fails a pull request that changes shipped plugin files without raising the
// manifest Version above the one on the base branch.
// Usage: node scripts/check-version-bump.mjs origin/<base_ref>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MANIFEST = "teams-reactions/com.laurens-bolle.teams-reactions.sdPlugin/manifest.json";
const PLUGIN_PATHS = [
  /^TeamsReactionPOC\.m$/,
  /^teams-reactions\/src\//,
  /^teams-reactions\/com\.laurens-bolle\.teams-reactions\.sdPlugin\//,
  /^teams-reactions\/package\.json$/,
  /^teams-reactions\/package-lock\.json$/,
];
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parse(version) {
  if (typeof version !== "string" || !VERSION.test(version)) {
    throw new Error(`Invalid version ${JSON.stringify(version)}: expected four non-negative integers, e.g. 0.2.0.10`);
  }
  return version.split(".").map(Number);
}

/** Returns a negative number, 0 or a positive number as a is below, equal to or above b. */
export function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 4; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function isPluginPath(path) {
  return PLUGIN_PATHS.some((pattern) => pattern.test(path));
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main(base) {
  if (!base) throw new Error("Usage: check-version-bump.mjs <base-ref>, e.g. origin/main");
  // Three-dot diff: changes on this branch since it forked from base.
  const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  const plugin = changed.filter(isPluginPath);
  if (plugin.length === 0) {
    console.log(`No plugin files changed against ${base}; no version bump required.`);
    return 0;
  }
  const baseVersion = JSON.parse(git("show", `${base}:${MANIFEST}`)).Version;
  const headVersion = JSON.parse(readFileSync(MANIFEST, "utf8")).Version;
  if (compareVersions(headVersion, baseVersion) > 0) {
    console.log(`Version bumped from ${baseVersion} to ${headVersion}.`);
    return 0;
  }
  console.error(`Plugin files changed but Version is ${headVersion} (base ${base}: ${baseVersion}).`);
  console.error(`Raise Version in ${MANIFEST}. Changed plugin files:`);
  for (const file of plugin) console.error(`  ${file}`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
