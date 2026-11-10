import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_REACTION, ReactionKeyController, reactionFromSettings, reactionKeyImage } from "../src/reaction-key.ts";

const REACTIONS = ["like", "love", "applause", "laugh", "surprise"];

function fakeKey(id = "key") {
	const calls = [];
	return {
		id,
		calls,
		showOk: async () => { calls.push("showOk"); },
		showAlert: async () => { calls.push("showAlert"); },
	};
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

const burst = (reaction, accepted = 3) => ({ reaction, attempted: 4, accessibilityAccepted: accepted, elapsedMs: 900, stopReason: "released" });

/**
 * Fake coordinators. `start` and `send` are the results the burst and
 * single-send coordinators return; an Error is thrown instead of returned.
 */
function setup({ start, send } = {}) {
	const calls = [];
	const logger = fakeLogger();
	const controller = new ReactionKeyController({
		startBurst(id, reaction) {
			calls.push(["startBurst", id, reaction]);
			if (start instanceof Error) throw start;
			return start ?? { status: "started", completion: Promise.resolve(burst(reaction)) };
		},
		stopBurst(id) { calls.push(["stopBurst", id]); },
		async sendOnce(reaction) {
			calls.push(["sendOnce", reaction]);
			if (send instanceof Error) throw send;
			return send ?? { status: "completed" };
		},
	}, logger);
	return { controller, calls, logger };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

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

test("a picker set to Love starts the same reaction wave as the fixed Love key", async () => {
	const fixed = setup();
	await fixed.controller.keyDown(fakeKey("fixed"), "love", false);
	const picker = setup();
	await picker.controller.keyDown(fakeKey("picker"), reactionFromSettings({ reaction: "love" }), false);
	assert.deepEqual(fixed.calls, [["startBurst", "fixed", "love"]]);
	assert.deepEqual(picker.calls, [["startBurst", "picker", "love"]]);
});

test("a picker in a Multi Action sends the same single reaction as the fixed key", async () => {
	const fixed = setup();
	const fixedKey = fakeKey();
	await fixed.controller.keyDown(fixedKey, "applause", true);
	const picker = setup();
	const pickerKey = fakeKey();
	await picker.controller.keyDown(pickerKey, reactionFromSettings({ reaction: "applause" }), true);
	for (const { calls, logger } of [fixed, picker]) {
		assert.deepEqual(calls, [["sendOnce", "applause"]]);
		assert.deepEqual(logger.lines, [["info", "Sent one Teams reaction command: applause."]]);
	}
	assert.deepEqual(fixedKey.calls, ["showOk"]);
	assert.deepEqual(pickerKey.calls, ["showOk"]);
});

test("a completed reaction wave logs its result and confirms accepted attempts", async () => {
	const { controller, logger } = setup();
	const key = fakeKey();
	await controller.keyDown(key, "laugh", false);
	await flush();
	assert.deepEqual(logger.lines, [["info", "Teams reaction burst laugh: attempted=4, accepted=3, elapsedMs=900, stop=released."]]);
	assert.deepEqual(key.calls, ["showOk"]);
});

test("a reaction wave with no accepted attempts alerts", async () => {
	const { controller } = setup({ start: { status: "started", completion: Promise.resolve(burst("like", 0)) } });
	const key = fakeKey();
	await controller.keyDown(key, "like", false);
	await flush();
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a busy Teams operation alerts instead of starting a wave", async () => {
	const { controller, logger } = setup({ start: { status: "busy" } });
	const key = fakeKey();
	await controller.keyDown(key, "love", false);
	assert.deepEqual(logger.lines, [["warn", "Ignored love because another Teams operation is running."]]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a busy Teams operation alerts instead of sending once", async () => {
	const { controller, logger } = setup({ send: { status: "busy" } });
	const key = fakeKey();
	await controller.keyDown(key, "laugh", true);
	assert.deepEqual(logger.lines, [["warn", "Ignored laugh because another Teams operation is running."]]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a wave that fails to start reports the error and alerts", async () => {
	const error = new Error("launch");
	const { controller, logger } = setup({ start: error });
	const key = fakeKey();
	await controller.keyDown(key, "surprise", false);
	assert.deepEqual(logger.lines, [["error", "Teams reaction burst surprise", error]]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a wave that fails after starting reports the error and alerts", async () => {
	const error = new Error("crash");
	const completion = Promise.reject(error);
	completion.catch(() => {});
	const { controller, logger } = setup({ start: { status: "started", completion } });
	const key = fakeKey();
	await controller.keyDown(key, "like", false);
	await flush();
	assert.deepEqual(logger.lines, [["error", "Teams reaction burst like", error]]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a single send that fails reports the error and alerts", async () => {
	const error = new Error("helper");
	const { controller, logger } = setup({ send: error });
	const key = fakeKey();
	await controller.keyDown(key, "love", true);
	assert.deepEqual(logger.lines, [["error", "Teams reaction love", error]]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("release stops the key's reaction wave", () => {
	const { controller, calls } = setup();
	controller.release("key-7");
	assert.deepEqual(calls, [["stopBurst", "key-7"]]);
});
