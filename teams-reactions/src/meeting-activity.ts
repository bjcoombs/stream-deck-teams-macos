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
 * - While inactive, status is read again every RECHECK_MS, because Teams may
 *   publish nothing when a meeting starts. A press while inactive reads status
 *   first and runs if that read shows a meeting.
 */
import type { TeamsState } from "./helper-runner";

/** Minimum gap between the two no-meeting results that make keys inactive. */
export const CONFIRM_DELAY_MS = 2_000;
/** After a command ends, no status counts towards inactive for this long. */
export const COMMAND_HOLD_MS = 3_000;
/** While inactive and keys are visible, status is read again this often until it shows a meeting. */
export const RECHECK_MS = 2_000;

export type ActivityClock = {
	now(): number;
	/** Runs the callback once after ms; the returned function cancels it. */
	schedule(callback: () => void, ms: number): () => void;
};

const FIELDS = ["microphone", "camera", "backgroundBlur", "hand", "screenShare"] as const;

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
	private cancelRecheck: (() => void) | undefined;
	private watching = true;
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

	/** Whether any key is visible. Rechecks run only while one is. */
	setWatching(watching: boolean): void {
		this.watching = watching;
		this.stopRechecks();
		if (watching && !this.live) this.recheckAfter(RECHECK_MS);
	}

	/**
	 * Decides a key-down. While inactive it reads status first, so a press never
	 * fails on stale state. A hold key passes `stillHeld` so a key released during
	 * the read does not start a hold that no release will end.
	 */
	async admitPress(refresh: () => Promise<void>, stillHeld: () => boolean = () => true): Promise<boolean> {
		if (this.live) return true;
		try {
			await refresh();
		} catch {
			this.reportStatus(undefined);
		}
		return this.live && stillHeld();
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
		if (this.watching) this.recheckAfter(RECHECK_MS);
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
		this.stopRechecks();
		this.live = true;
	}

	/** Each recheck schedules the next before reading, so a busy or failed read cannot end the chain. */
	private recheckAfter(ms: number): void {
		this.cancelRecheck = this.clock.schedule(() => {
			this.recheckAfter(RECHECK_MS);
			this.confirm();
		}, ms);
	}

	private stopRechecks(): void {
		this.cancelRecheck?.();
		this.cancelRecheck = undefined;
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
