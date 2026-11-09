import assert from "node:assert/strict";
import test from "node:test";

import { MUTE_ATTEMPTS, MUTE_RETRY_MS, PushToTalkController } from "../src/push-to-talk-controller.ts";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function fakeKey(id = "key", { alertFails = false } = {}) {
	const calls = [];
	return {
		id,
		calls,
		showAlert: () => { calls.push("showAlert"); return alertFails ? Promise.reject(new Error("gone")) : Promise.resolve(); },
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

const completed = (microphone, changed = true) => ({ status: "completed", microphone, changed });

/**
 * Fake Teams. `microphone` is the state read on key-down. `responses` maps a
 * command to a queue of results, errors or deferred promises; once a queue is
 * empty the command completes with the requested state.
 */
function setup({ microphone = "muted", read, responses = {} } = {}) {
	const commands = [];
	const waits = [];
	const logger = fakeLogger();
	const controller = new PushToTalkController({
		readMicrophone: read ?? (async () => microphone),
		async execute(command) {
			commands.push(command);
			const next = responses[command]?.shift();
			if (next instanceof Error) throw next;
			if (next?.promise) return next.promise;
			return next ?? completed(command === "mute" ? "muted" : "unmuted");
		},
		async wait(ms) { waits.push(ms); },
	}, logger);
	return { controller, commands, waits, logger };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("hold unmutes a muted microphone and release mutes it again", async () => {
	const { controller, commands } = setup();
	const key = fakeKey();
	await controller.keyDown(key, false);
	assert.deepEqual(commands, ["unmute"]);
	await controller.keyUp(key);
	assert.deepEqual(commands, ["unmute", "mute"]);
	assert.deepEqual(key.calls, []);
});

test("an already unmuted microphone is left alone on both edges", async () => {
	const { controller, commands, logger } = setup({ microphone: "unmuted" });
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.deepEqual(commands, []);
	assert.deepEqual(key.calls, []);
	assert.match(logger.lines[0][1], /already unmuted/);
});

test("an unknown microphone state alerts and sends nothing", async () => {
	for (const microphone of ["unknown", "unavailable", undefined]) {
		const { controller, commands } = setup({ read: async () => microphone });
		const key = fakeKey();
		await controller.keyDown(key, false);
		await controller.keyUp(key);
		assert.deepEqual(commands, [], `state ${microphone}`);
		assert.deepEqual(key.calls, ["showAlert"]);
	}
});

test("a failed state read is reported, alerts and sends nothing", async () => {
	const failure = new Error("helper failed");
	const { controller, commands, logger } = setup({ read: async () => { throw failure; } });
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.deepEqual(commands, []);
	assert.deepEqual(key.calls, ["showAlert"]);
	assert.deepEqual(logger.lines[0], ["error", "Push to Talk microphone state", failure]);
});

test("a multi-action press is refused with an alert", async () => {
	const { controller, commands, logger } = setup();
	const key = fakeKey();
	await controller.keyDown(key, true);
	await controller.keyUp(key);
	assert.deepEqual(commands, []);
	assert.deepEqual(key.calls, ["showAlert"]);
	assert.match(logger.lines[0][1], /multi-action/);
});

test("a busy unmute alerts and release does not mute", async () => {
	const { controller, commands } = setup({ responses: { unmute: [{ status: "busy" }] } });
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.deepEqual(commands, ["unmute"]);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("an unmute that finds the microphone already unmuted does not mute on release", async () => {
	const { controller, commands } = setup({ responses: { unmute: [completed("unmuted", false)] } });
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.deepEqual(commands, ["unmute"]);
	assert.deepEqual(key.calls, []);
});

test("a failed or unconfirmed unmute alerts and still mutes on release", async () => {
	for (const outcome of [new Error("exit 13"), completed("unknown")]) {
		const { controller, commands } = setup({ responses: { unmute: [outcome] } });
		const key = fakeKey();
		await controller.keyDown(key, false);
		assert.deepEqual(key.calls, ["showAlert"]);
		await controller.keyUp(key);
		assert.deepEqual(commands, ["unmute", "mute"]);
	}
});

test("a release during the unmute waits for it, then mutes", async () => {
	const unmute = deferred();
	const { controller, commands } = setup({ responses: { unmute: [unmute] } });
	const key = fakeKey();
	const down = controller.keyDown(key, false);
	await flush();
	const up = controller.keyUp(key);
	await flush();
	assert.deepEqual(commands, ["unmute"], "mute must not race the unmute for the operation lock");
	unmute.resolve(completed("unmuted"));
	await Promise.all([down, up]);
	assert.deepEqual(commands, ["unmute", "mute"]);
});

test("a release before the state read finishes sends nothing", async () => {
	const read = deferred();
	const { controller, commands } = setup({ read: () => read.promise });
	const key = fakeKey();
	const down = controller.keyDown(key, false);
	const up = controller.keyUp(key);
	read.resolve("muted");
	await Promise.all([down, up]);
	assert.deepEqual(commands, []);
});

test("a busy release mute retries until it succeeds", async () => {
	const busy = { status: "busy" };
	const { controller, commands, waits } = setup({ responses: { mute: [busy, busy] } });
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.deepEqual(commands, ["unmute", "mute", "mute", "mute"]);
	assert.deepEqual(waits, [MUTE_RETRY_MS, MUTE_RETRY_MS]);
	assert.deepEqual(key.calls, []);
});

test("a release mute that is never confirmed gives up with one alert", async () => {
	const { controller, commands, waits, logger } = setup({ responses: { mute: Array.from({ length: MUTE_ATTEMPTS }, () => ({ status: "busy" })) } });
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.equal(commands.filter(command => command === "mute").length, MUTE_ATTEMPTS);
	assert.equal(waits.length, MUTE_ATTEMPTS - 1);
	assert.deepEqual(key.calls, ["showAlert"]);
	assert.match(logger.lines.at(-1)[1], /could not confirm the microphone muted/);
});

test("a failed or unconfirmed release mute retries until Teams confirms it", async () => {
	for (const outcome of [new Error("helper failed"), completed("unknown")]) {
		const { controller, commands, waits, logger } = setup({ responses: { mute: [outcome, { status: "busy" }] } });
		const key = fakeKey();
		await controller.keyDown(key, false);
		await controller.keyUp(key);
		assert.deepEqual(commands, ["unmute", "mute", "mute", "mute"]);
		assert.deepEqual(waits, [MUTE_RETRY_MS, MUTE_RETRY_MS]);
		assert.deepEqual(key.calls, []);
		assert.match(logger.lines.at(-1)[1], /muted the microphone again/);
	}
});

test("release mute failures of every kind share one attempt budget", async () => {
	const mixed = Array.from({ length: MUTE_ATTEMPTS }, (_, index) => [new Error("helper failed"), completed("unknown"), { status: "busy" }][index % 3]);
	const { controller, commands } = setup({ responses: { mute: mixed } });
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.equal(commands.filter(command => command === "mute").length, MUTE_ATTEMPTS);
	assert.deepEqual(key.calls, ["showAlert"]);
});

test("a key that disappears while held mutes again", async () => {
	const { controller, commands } = setup();
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.disappear(key.id);
	assert.deepEqual(commands, ["unmute", "mute"]);
	await controller.keyUp(key);
	assert.deepEqual(commands, ["unmute", "mute"], "a late key-up after disappear does nothing");
});

test("releaseAll mutes for every held key that unmuted and ignores the rest", async () => {
	let microphone = "muted";
	const { controller, commands } = setup({ read: async () => microphone });
	const first = fakeKey("first");
	const second = fakeKey("second");
	await controller.keyDown(first, false);
	microphone = "unmuted";
	await controller.keyDown(second, false);
	await controller.releaseAll();
	assert.deepEqual(commands, ["unmute", "mute"]);
	await controller.releaseAll();
	assert.deepEqual(commands, ["unmute", "mute"], "nothing is held after releaseAll");
});

test("a repeated key-down while held is ignored", async () => {
	const { controller, commands } = setup();
	const key = fakeKey();
	await controller.keyDown(key, false);
	await controller.keyDown(key, false);
	await controller.keyUp(key);
	assert.deepEqual(commands, ["unmute", "mute"]);
});

test("a new press waits for the previous release mute before reading state", async () => {
	const mute = deferred();
	let reads = 0;
	const { controller, commands } = setup({ read: async () => { reads += 1; return "muted"; }, responses: { mute: [mute] } });
	const key = fakeKey();
	await controller.keyDown(key, false);
	const up = controller.keyUp(key);
	await flush();
	const down = controller.keyDown(key, false);
	await flush();
	assert.equal(reads, 1, "the second press must not read state while the mute is in flight");
	mute.resolve(completed("muted"));
	await Promise.all([up, down]);
	assert.equal(reads, 2);
	assert.deepEqual(commands, ["unmute", "mute", "unmute"]);
});

test("an alert that cannot be shown is logged and never rejects", async () => {
	const { controller, logger } = setup();
	const key = fakeKey("key", { alertFails: true });
	await controller.keyDown(key, true);
	assert.match(logger.lines.at(-1)[1], /Could not show the Push to Talk alert/);
});
