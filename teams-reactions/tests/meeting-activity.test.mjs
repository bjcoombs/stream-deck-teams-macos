import assert from "node:assert/strict";
import test from "node:test";

import { COMMAND_HOLD_MS, CONFIRM_DELAY_MS, MeetingActivity, inactiveKeyImage, showsNoMeeting } from "../src/meeting-activity.ts";

const NO_MEETING = { meetingActive: false, microphone: "unavailable", camera: "unavailable", backgroundBlur: "unavailable", hand: "unavailable" };
const MEETING = { meetingActive: true, microphone: "muted", camera: "off", backgroundBlur: "unknown", hand: "lowered" };
/** What status reads while the Teams video effects panel is open: no meeting, but a blur selection. */
const EFFECTS_PANEL = { ...NO_MEETING, backgroundBlur: "off" };

/** A manual clock. advance() fires due timers in order, as setTimeout would. */
function fakeClock() {
	let now = 1_000;
	let timers = [];
	return {
		now: () => now,
		schedule(callback, ms) {
			const timer = { at: now + ms, callback };
			timers.push(timer);
			return () => { timers = timers.filter(t => t !== timer); };
		},
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
				if (!due) break;
				timers = timers.filter(t => t !== due);
				now = due.at;
				due.callback();
			}
			now = end;
		},
		get pending() { return timers.map(t => t.at - now); },
	};
}

/** An activity whose confirmation reads the next queued status, or records the request. */
function setup() {
	const clock = fakeClock();
	const activity = new MeetingActivity(clock);
	const confirmations = [];
	const replies = [];
	activity.confirmWith(() => {
		confirmations.push(clock.now());
		if (replies.length > 0) activity.reportStatus(replies.shift());
	});
	return { clock, activity, confirmations, replies };
}

test("showsNoMeeting needs no meeting and every control unavailable", () => {
	assert.equal(showsNoMeeting(NO_MEETING), true);
	assert.equal(showsNoMeeting(MEETING), false);
	assert.equal(showsNoMeeting({ ...NO_MEETING, meetingActive: true }), false);
	for (const field of ["microphone", "camera", "backgroundBlur", "hand"]) {
		assert.equal(showsNoMeeting({ ...NO_MEETING, [field]: "unknown" }), false, `${field} unknown is not evidence`);
	}
	assert.equal(showsNoMeeting(EFFECTS_PANEL), false);
	assert.equal(showsNoMeeting({ ...NO_MEETING, backgroundBlur: "on" }), false);
});

test("inactiveKeyImage names the dimmed twin", () => {
	assert.equal(inactiveKeyImage("imgs/actions/mute/muted"), "imgs/actions/mute/muted-inactive");
});

test("keys start live and the default confirmation does nothing", () => {
	const clock = fakeClock();
	const activity = new MeetingActivity(clock);
	assert.equal(activity.active, true);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, true);
});

test("one no-meeting status keeps keys live and asks for a confirmation", () => {
	const { clock, activity, confirmations } = setup();
	activity.reportStatus(NO_MEETING);
	assert.equal(activity.active, true);
	assert.deepEqual(clock.pending, [CONFIRM_DELAY_MS]);
	clock.advance(CONFIRM_DELAY_MS - 1);
	assert.deepEqual(confirmations, []);
	clock.advance(1);
	assert.deepEqual(confirmations, [1_000 + CONFIRM_DELAY_MS]);
});

test("two no-meeting results far enough apart make keys inactive", () => {
	const { clock, activity, replies } = setup();
	replies.push(NO_MEETING);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, false);
	assert.deepEqual(clock.pending, []);
});

test("a second no-meeting result too soon waits for the rest of the delay", () => {
	const { clock, activity, replies } = setup();
	activity.reportStatus(NO_MEETING);
	clock.advance(500);
	activity.reportStatus(NO_MEETING);
	assert.equal(activity.active, true);
	assert.deepEqual(clock.pending, [CONFIRM_DELAY_MS - 500]);
	replies.push(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS - 500);
	assert.equal(activity.active, false);
});

test("a meeting between two no-meeting results restarts the count", () => {
	const { clock, activity } = setup();
	activity.reportStatus(NO_MEETING);
	clock.advance(1_000);
	activity.reportStatus(MEETING);
	assert.deepEqual(clock.pending, [], "the confirmation is cancelled");
	clock.advance(CONFIRM_DELAY_MS);
	activity.reportStatus(NO_MEETING);
	assert.equal(activity.active, true);
});

test("the first meeting result makes inactive keys live again", () => {
	const { clock, activity, replies } = setup();
	replies.push(NO_MEETING);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, false);
	activity.reportStatus(MEETING);
	assert.equal(activity.active, true);
});

test("a failed status makes keys live and resets the count", () => {
	const { clock, activity, replies } = setup();
	replies.push(NO_MEETING);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, false);
	activity.reportStatus(undefined);
	assert.equal(activity.active, true);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS - 1);
	activity.reportStatus(undefined);
	clock.advance(1);
	assert.equal(activity.active, true);
});

test("further no-meeting results while inactive schedule nothing", () => {
	const { clock, activity, replies, confirmations } = setup();
	replies.push(NO_MEETING);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS);
	activity.reportStatus(NO_MEETING);
	activity.reportCommandResult(NO_MEETING);
	assert.equal(activity.active, false);
	assert.deepEqual(clock.pending, []);
	assert.equal(confirmations.length, 1);
});

test("the effects panel left open never makes keys inactive", () => {
	const { clock, activity } = setup();
	for (let i = 0; i < 10; i += 1) {
		activity.reportStatus(EFFECTS_PANEL);
		clock.advance(CONFIRM_DELAY_MS);
	}
	assert.equal(activity.active, true);
	assert.deepEqual(clock.pending, []);
});

test("a briefly opened effects panel that reads as no meeting is covered by the delay", () => {
	const { clock, activity, replies } = setup();
	activity.reportStatus(NO_MEETING);
	replies.push(MEETING);
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, true);
});

test("no status counts while a command runs", () => {
	const { clock, activity, replies } = setup();
	activity.commandStarted();
	activity.reportStatus(NO_MEETING);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS * 3);
	assert.equal(activity.active, true);
	assert.deepEqual(clock.pending, [], "evidence waits for the command to finish");
	replies.push(NO_MEETING, NO_MEETING);
	activity.commandFinished();
	assert.deepEqual(clock.pending, [COMMAND_HOLD_MS]);
	clock.advance(COMMAND_HOLD_MS);
	assert.equal(activity.active, true, "the confirmation after the hold is only the first vote");
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, false);
});

test("a command start cancels a pending confirmation and the first vote", () => {
	const { clock, activity, confirmations } = setup();
	activity.reportStatus(NO_MEETING);
	activity.commandStarted();
	assert.deepEqual(clock.pending, []);
	activity.commandFinished();
	assert.deepEqual(clock.pending, [], "no evidence arrived during the command");
	clock.advance(COMMAND_HOLD_MS);
	activity.reportStatus(NO_MEETING);
	clock.advance(0);
	assert.deepEqual(confirmations, [1_000 + COMMAND_HOLD_MS], "the first status after the command is asked again");
	assert.equal(activity.active, true);
});

test("the first status after a command never counts, even after the hold", () => {
	const { clock, activity, replies } = setup();
	activity.commandStarted();
	activity.commandFinished();
	clock.advance(COMMAND_HOLD_MS + 10);
	replies.push(NO_MEETING, NO_MEETING);
	activity.reportStatus(NO_MEETING);
	assert.deepEqual(clock.pending, [0], "it asks again at once");
	clock.advance(0);
	assert.equal(activity.active, true);
	assert.deepEqual(clock.pending, [CONFIRM_DELAY_MS]);
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, false);
});

test("a blur press that reads the effects panel as no meeting cannot make keys inactive", () => {
	const { clock, activity, replies } = setup();
	activity.commandStarted();
	activity.reportStatus(NO_MEETING);
	activity.commandFinished();
	activity.reportCommandResult(NO_MEETING);
	clock.advance(500);
	activity.reportStatus(NO_MEETING);
	assert.equal(activity.active, true);
	assert.deepEqual(clock.pending, [COMMAND_HOLD_MS - 500]);
	replies.push(MEETING);
	clock.advance(COMMAND_HOLD_MS);
	assert.equal(activity.active, true);
	assert.deepEqual(clock.pending, []);
});

test("statuses inside the hold are deferred to its end", () => {
	const { clock, activity, replies, confirmations } = setup();
	activity.commandStarted();
	activity.commandFinished();
	activity.reportStatus(MEETING);
	clock.advance(1_000);
	activity.reportStatus(NO_MEETING);
	assert.deepEqual(clock.pending, [COMMAND_HOLD_MS - 1_000]);
	replies.push(NO_MEETING, NO_MEETING);
	clock.advance(COMMAND_HOLD_MS - 1_000);
	assert.equal(confirmations.length, 1);
	assert.equal(activity.active, true);
	clock.advance(CONFIRM_DELAY_MS);
	assert.equal(activity.active, false);
});

test("a command result showing a meeting makes keys live", () => {
	const { clock, activity, replies } = setup();
	replies.push(NO_MEETING);
	activity.reportStatus(NO_MEETING);
	clock.advance(CONFIRM_DELAY_MS);
	activity.reportCommandResult(MEETING);
	assert.equal(activity.active, true);
});

test("a Leave result showing no meeting is confirmed after the hold", () => {
	const { clock, activity, replies, confirmations } = setup();
	activity.commandStarted();
	activity.commandFinished();
	activity.reportCommandResult(NO_MEETING);
	assert.equal(activity.active, true);
	replies.push(NO_MEETING, NO_MEETING);
	clock.advance(COMMAND_HOLD_MS + CONFIRM_DELAY_MS);
	assert.deepEqual(confirmations, [1_000 + COMMAND_HOLD_MS, 1_000 + COMMAND_HOLD_MS + CONFIRM_DELAY_MS]);
	assert.equal(activity.active, false);
});

test("a command result showing no meeting during a command waits for it to finish", () => {
	const { clock, activity } = setup();
	activity.commandStarted();
	activity.commandStarted();
	activity.reportCommandResult(NO_MEETING);
	activity.commandFinished();
	assert.deepEqual(clock.pending, [], "another command still runs");
	activity.commandFinished();
	assert.deepEqual(clock.pending, [COMMAND_HOLD_MS]);
});

test("a later evidence replaces a pending confirmation instead of adding one", () => {
	const { clock, activity } = setup();
	activity.reportStatus(NO_MEETING);
	clock.advance(500);
	activity.reportStatus(NO_MEETING);
	assert.equal(clock.pending.length, 1);
});
