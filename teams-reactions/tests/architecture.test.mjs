import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const pluginRoot = new URL("..", import.meta.url).pathname;
const repoRoot = path.join(pluginRoot, "..");

// Line ceilings ratchet down only. Raising one needs a reason in the commit message.
const LINE_CEILINGS = {
	"TeamsReactionPOC.m": 1775,
	"teams-reactions/src/helper-runner.ts": 700,
	"teams-reactions/src/actions/call-controls.ts": 245,
};
const DEFAULT_SOURCE_CEILING = 300;

async function sourceFiles(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
	return entries.filter(e => e.isFile() && e.name.endsWith(".ts")).map(e => path.join(e.parentPath, e.name));
}

async function lineCount(file) {
	return (await fs.readFile(file, "utf8")).split("\n").length;
}

test("source files stay under their line ceilings", async () => {
	const files = [path.join(repoRoot, "TeamsReactionPOC.m"), ...await sourceFiles(path.join(pluginRoot, "src"))];
	for (const file of files) {
		const relative = path.relative(repoRoot, file);
		const ceiling = LINE_CEILINGS[relative] ?? DEFAULT_SOURCE_CEILING;
		assert.ok(await lineCount(file) <= ceiling, `${relative} exceeds its ${ceiling}-line ceiling`);
	}
});

test("only helper-runner.ts launches processes", async () => {
	for (const file of await sourceFiles(path.join(pluginRoot, "src"))) {
		if (file.endsWith(path.join("src", "helper-runner.ts"))) continue;
		const text = await fs.readFile(file, "utf8");
		assert.doesNotMatch(text, /node:child_process|\bexecFile\(|\bspawn\(/, `${path.relative(pluginRoot, file)} must launch the helper through helper-runner.ts`);
	}
});

test("actions reach the helper only through teams-services.ts", async () => {
	for (const file of await sourceFiles(path.join(pluginRoot, "src", "actions"))) {
		const text = await fs.readFile(file, "utf8");
		assert.doesNotMatch(text, /\b(runTeamsCommand|runReactionHelper|startReactionBurst)\b/, `${path.basename(file)} must use the coordinators in teams-services.ts`);
	}
});

test("Leave Call is guarded by the hold gate", async () => {
	const controller = await fs.readFile(path.join(pluginRoot, "src", "leave-controller.ts"), "utf8");
	assert.match(controller, /\.press\(/, "leave-controller.ts must arm the hold gate on key-down");
	assert.doesNotMatch(controller, /@elgato\/streamdeck/, "leave-controller.ts must stay free of the Stream Deck SDK so tests can load it");
	const text = await fs.readFile(path.join(pluginRoot, "src", "actions", "call-controls.ts"), "utf8");
	const leave = text.slice(text.indexOf("export class LeaveAction"));
	assert.match(leave, /leaveController\.keyDown\(/, "LeaveAction must delegate key-down to the Leave controller");
	assert.doesNotMatch(leave.slice(0, leave.indexOf("onKeyUp")), /execute\("leave"\)/, "onKeyDown must not run leave directly");
});
