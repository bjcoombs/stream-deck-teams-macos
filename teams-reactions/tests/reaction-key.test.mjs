import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_REACTION, ReactionKeyController, reactionFromSettings, reactionKeyImage } from "../src/reaction-key.ts";

const REACTIONS = ["like", "love", "applause", "laugh", "surprise"];

function fakeKey({ fails = false } = {}) {
	const calls = [];
	const show = name => async () => { calls.push(name); if (fails) throw new Error("gone"); };
	return { calls, showOk: show("showOk"), showAlert: show("showAlert") };
}

function fakeLogger() {
	const lines = [];
	return {
		lines,
		info: message => lines.push(["info", message]),
		warn: message => lines.push(["warn", message]),
		reportError: (operation, error) => lines.push(["error", operation, error]),
	};
}

/** A fake single-send coordinator. `send` is its result; an Error is thrown instead of returned. */
function setup({ send } = {}) {
	const calls = [];
	const logger = fakeLogger();
	const controller = new ReactionKeyController({
		async sendOnce(reaction) {
			calls.push(["sendOnce", reaction]);
			if (send instanceof Error) throw send;
			return send ?? { status: "completed" };
		},
	}, logger);
	return { controller, calls, logger };
}

test("each Teams reaction setting selects that reaction", () => {
	for (const reaction of REACTIONS) assert.equal(reactionFromSettings({ reaction }), reaction);
});

test("missing or invalid settings fall back to Like", () => {
	assert.equal(DEFAULT_REACTION, "like");
	for (const settings of [undefined, null, "love", 3, {}, { reaction: "thumbsdown" }, { reaction: "" }, { reaction: 1 }, { reaction: "toString" }, { reaction: "LOVE" }, { reaction: ["love"] }]) {
		assert.equal(reactionFromSettings(settings), "like", `settings ${JSON.stringify(settings)}`);
	}
});

test("the key image follows the reaction", () => {
	assert.equal(reactionKeyImage("love"), "imgs/actions/love/key");
	assert.equal(reactionKeyImage("surprise"), "imgs/actions/surprise/key");
});

test("a press sends exactly one reaction and confirms it", async () => {
	const fixed = setup();
	const fixedKey = fakeKey();
	await fixed.controller.keyDown(fixedKey, "applause");
	const picker = setup();
	const pickerKey = fakeKey();
	await picker.controller.keyDown(pickerKey, reactionFromSettings({ reaction: "applause" }));
	for (const { calls, logger } of [fixed, picker]) {
		assert.deepEqual(calls, [["sendOnce", "applause"]]);
		assert.deepEqual(logger.lines, [["info", "Sent one Teams reaction command: applause."]]);
	}
	assert.deepEqual(fixedKey.calls, ["showOk"]);
	assert.deepEqual(pickerKey.calls, ["showOk"]);
});

test("a busy Teams operation alerts instead of sending", async () => {
	const { controller, logger } = setup({ send: { status: "busy" } });
	const key = fakeKey();
	await controller.keyDown(key, "laugh");
	assert.deepEqual(logger.lines, [["warn", "Ignored laugh because another Teams operation is running."]]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a send that fails reports the error and alerts", async () => {
	const error = new Error("helper");
	const { controller, logger } = setup({ send: error });
	const key = fakeKey();
	await controller.keyDown(key, "love");
	assert.deepEqual(logger.lines, [["error", "Teams reaction love", error]]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a key that cannot show the result logs instead of rejecting", async () => {
	for (const send of [undefined, { status: "busy" }, new Error("helper")]) {
		const { controller, logger } = setup({ send });
		const key = fakeKey({ fails: true });
		await controller.keyDown(key, "surprise");
		assert.equal(key.calls.length, 1);
		assert.deepEqual(logger.lines.at(-1), ["warn", "Could not show the result of the surprise reaction."]);
	}
});
