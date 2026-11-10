import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const pluginRoot = new URL("..", import.meta.url).pathname;
const repoRoot = path.join(pluginRoot, "..");

// Line ceilings ratchet down only. Raising one needs a reason in the commit message.
const LINE_CEILINGS = {
	"TeamsReactionPOC.m": 1800,
	"teams-reactions/src/helper-runner.ts": 545,
	"teams-reactions/src/actions/call-controls.ts": 160,
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
		assert.doesNotMatch(text, /\b(runTeamsCommand|runReactionHelper)\b/, `${path.basename(file)} must use the coordinators in teams-services.ts`);
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

test("Push to Talk logic stays in its SDK-free controller", async () => {
	const controller = await fs.readFile(path.join(pluginRoot, "src", "push-to-talk-controller.ts"), "utf8");
	assert.doesNotMatch(controller, /@elgato\/streamdeck/, "push-to-talk-controller.ts must stay free of the Stream Deck SDK so tests can load it");
	const text = await fs.readFile(path.join(pluginRoot, "src", "actions", "push-to-talk.ts"), "utf8");
	assert.match(text, /pushToTalkController\.keyDown\(/, "PushToTalkAction must delegate key-down to the controller");
	assert.match(text, /pushToTalkController\.keyUp\(/, "PushToTalkAction must delegate key-up to the controller");
});

test("reaction keys share the SDK-free reaction key controller", async () => {
	const controller = await fs.readFile(path.join(pluginRoot, "src", "reaction-key.ts"), "utf8");
	assert.doesNotMatch(controller, /@elgato\/streamdeck/, "reaction-key.ts must stay free of the Stream Deck SDK so tests can load it");
	const text = await fs.readFile(path.join(pluginRoot, "src", "actions", "reactions.ts"), "utf8");
	assert.match(text, /reactionKeyController\.keyDown\(/, "reaction actions must delegate key-down to the controller");
	assert.doesNotMatch(text, /onKeyUp/, "a reaction key release does nothing: Teams has no hold-to-repeat reaction");
});

test("the meeting activity decision stays in its SDK-free module", async () => {
	const module = await fs.readFile(path.join(pluginRoot, "src", "meeting-activity.ts"), "utf8");
	assert.doesNotMatch(module, /@elgato\/streamdeck/, "meeting-activity.ts must stay free of the Stream Deck SDK so tests can load it");
});

test("every Teams key-down is gated while no meeting is active, and no release is", async () => {
	const files = ["call-controls.ts", "background-blur.ts", "push-to-talk.ts", "reactions.ts"];
	for (const name of files) {
		const text = await fs.readFile(path.join(pluginRoot, "src", "actions", name), "utf8");
		const methods = text.split(/\n\toverride /).slice(1);
		const keyDowns = methods.filter(m => /^(async )?onKeyDown\(/.test(m));
		assert.ok(keyDowns.length > 0, `${name} handles key-down`);
		for (const method of keyDowns) {
			const body = method.slice(0, method.indexOf("\n\t}"));
			assert.match(body, /if \(!\(await pressAllowed\([^)]*\)\)\) return;/, `${name} onKeyDown must check pressAllowed() first`);
		}
		for (const method of methods.filter(m => /^(async )?(onKeyUp|onWillDisappear)\(/.test(m))) {
			assert.doesNotMatch(method.slice(0, method.indexOf("\n\t}")), /pressAllowed/, `${name} must never gate a release`);
		}
	}
});

test("hold keys cancel an inactive-state press when released during its status read", async () => {
	const pushToTalk = await fs.readFile(path.join(pluginRoot, "src", "actions", "push-to-talk.ts"), "utf8");
	const controls = await fs.readFile(path.join(pluginRoot, "src", "actions", "call-controls.ts"), "utf8");
	const leave = controls.slice(controls.indexOf("export class LeaveAction"));
	for (const [name, text] of [["Push to Talk", pushToTalk], ["Leave", leave]]) {
		assert.match(text, /pressAllowed\(ev\.action\.id\)/, `${name} must pass its context to pressAllowed`);
		assert.match(text, /onKeyUp\(ev: KeyUpEvent\)[^}]*keyReleased\(ev\.action\.id\)/, `${name} must call keyReleased on key-up`);
	}
});
