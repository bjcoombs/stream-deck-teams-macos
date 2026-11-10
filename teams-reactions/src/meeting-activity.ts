/**
 * Decides whether Teams keys are live or inactive, free of the Stream Deck SDK so
 * tests can load it directly. A false "inactive" during a meeting is far worse
 * than a key that stays live after one ends, so every doubt resolves to live:
 * - Keys go inactive only after two status results, at least CONFIRM_DELAY_MS
 *   apart, both show no meeting. One result showing a meeting makes them live.
 * - A failed or unclear status makes them live.
 * - Teams reports meetingActive false while its video effects panel is open, and
 *   Background Blur opens that panel. A status still showing a blur selection is
 *   therefore not evidence, and no status counts while a command runs, within
 *   COMMAND_HOLD_MS after it, or as the first one after it.
 */
import type { TeamsState } from "./helper-runner";

/** Minimum gap between the two no-meeting results that make keys inactive. */
export const CONFIRM_DELAY_MS = 2_000;
/** After a command ends, no status counts towards inactive for this long. */
export const COMMAND_HOLD_MS = 3_000;

export type ActivityClock = {
	now(): number;
	/** Runs the callback once after ms; the returned function cancels it. */
	schedule(callback: () => void, ms: number): () => void;
};

const FIELDS = ["microphone", "camera", "backgroundBlur", "hand"] as const;

/**
 * True only when a status shows no meeting and no control at all. With no
 * meeting every control reads unavailable, except blur, which reads on or off
 * while the video effects panel is open.
 */
export function showsNoMeeting(state: TeamsState): boolean {
	return !state.meetingActive && FIELDS.every(field => state[field] === "unavailable");
}

/** The plugin-relative dimmed twin of a key image path. */
export function inactiveKeyImage(image: string): string {
	return `${image}-inactive`;
}

export class MeetingActivity {
	private readonly clock: ActivityClock;
	private live = true;
	private firstNoMeetingAt: number | undefined;
	private commandsRunning = 0;
	private holdUntil = 0;
	private skipNextStatus = false;
	private evidenceDuringCommand = false;
	private cancelConfirmation: (() => void) | undefined;
	private confirm: () => void = () => undefined;

	constructor(clock: ActivityClock) {
		this.clock = clock;
	}

	get active(): boolean {
		return this.live;
	}

	/** Sets the status read that a pending confirmation runs. Its result must come back through reportStatus. */
	confirmWith(confirm: () => void): void {
		this.confirm = confirm;
	}

	/** A status result from the poll or a refresh; undefined when the read failed. */
	reportStatus(state: TeamsState | undefined): void {
		const skipped = this.skipNextStatus;
		this.skipNextStatus = false;
		if (state === undefined || !showsNoMeeting(state)) {
			this.goLive();
			return;
		}
		if (!this.live) return;
		if (skipped || this.suppressed()) {
			this.deferEvidence();
			return;
		}
		const now = this.clock.now();
		if (this.firstNoMeetingAt === undefined) {
			this.firstNoMeetingAt = now;
			this.confirmAfter(CONFIRM_DELAY_MS);
			return;
		}
		const remaining = this.firstNoMeetingAt + CONFIRM_DELAY_MS - now;
		if (remaining > 0) {
			this.confirmAfter(remaining);
			return;
		}
		this.firstNoMeetingAt = undefined;
		this.live = false;
	}

	/** A command's own result. It can show a meeting, but never counts towards inactive. */
	reportCommandResult(state: TeamsState): void {
		if (!showsNoMeeting(state)) this.goLive();
		else if (this.live) this.deferEvidence();
	}

	/** Every Teams command except status calls this before it runs. */
	commandStarted(): void {
		this.commandsRunning += 1;
		this.firstNoMeetingAt = undefined;
		this.cancelPending();
	}

	/** Pairs with commandStarted, whether the command succeeded or failed. */
	commandFinished(): void {
		this.commandsRunning -= 1;
		this.holdUntil = this.clock.now() + COMMAND_HOLD_MS;
		this.skipNextStatus = true;
		if (this.evidenceDuringCommand) this.deferEvidence();
	}

	private suppressed(): boolean {
		return this.commandsRunning > 0 || this.clock.now() < this.holdUntil;
	}

	/**
	 * Evidence that cannot count yet is checked again once the hold ends, because
	 * Teams publishes state only when it changes and may send nothing more.
	 */
	private deferEvidence(): void {
		this.firstNoMeetingAt = undefined;
		this.evidenceDuringCommand = this.commandsRunning > 0;
		if (this.evidenceDuringCommand) return;
		// The confirmation is deliberate, so it counts even as the first status after a command.
		this.skipNextStatus = false;
		this.confirmAfter(Math.max(this.holdUntil - this.clock.now(), 0));
	}

	private goLive(): void {
		this.firstNoMeetingAt = undefined;
		this.cancelPending();
		this.live = true;
	}

	private cancelPending(): void {
		this.evidenceDuringCommand = false;
		this.cancelConfirmation?.();
		this.cancelConfirmation = undefined;
	}

	private confirmAfter(ms: number): void {
		this.cancelConfirmation?.();
		this.cancelConfirmation = this.clock.schedule(() => {
			this.cancelConfirmation = undefined;
			this.confirm();
		}, ms);
	}
}
