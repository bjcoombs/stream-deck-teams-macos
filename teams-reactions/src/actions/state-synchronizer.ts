import streamDeck, { type DidReceiveSettingsEvent, type KeyAction, type State, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { type BlurState, stickyBlur, type TeamsState } from "../helper-runner";
import { inactiveKeyImage } from "../meeting-activity";
import { commandCoordinator, meetingActivity, operationLock, persistentControls } from "../teams-services";

export type StateField = "microphone" | "camera" | "backgroundBlur" | "hand";
type KnownState = "muted" | "unmuted" | "on" | "off" | "raised" | "lowered";

const UNKNOWN_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="22" fill="#24262b"/><circle cx="72" cy="72" r="41" fill="none" stroke="#f0b429" stroke-width="9"/><text x="72" y="91" text-anchor="middle" font-family="Arial,sans-serif" font-size="58" font-weight="700" fill="#f0b429">?</text></svg>`;
const UNAVAILABLE_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="22" fill="#24262b"/><circle cx="72" cy="72" r="42" fill="none" stroke="#777b84" stroke-width="9"/><path d="M42 102L102 42" stroke="#777b84" stroke-width="10" stroke-linecap="round"/></svg>`;

/**
 * How a registered key looks. A state key follows `field`; any other key shows
 * `image`, or its manifest image when that is undefined. Every key shows the
 * dimmed twin of `restingImage` while no meeting is active.
 */
export type KeyLook = {
	field?: StateField;
	image?: string;
	restingImage: string;
};

type RegisteredKey = KeyLook & { action: KeyAction };

export function keyActionFromEvent(ev: WillAppearEvent | WillDisappearEvent | DidReceiveSettingsEvent): KeyAction | undefined {
	return "setState" in ev.action ? ev.action as KeyAction : undefined;
}

export function stateIndex(field: StateField, value: string): State | undefined {
	const mappings: Record<StateField, readonly [KnownState, KnownState]> = {
		microphone: ["unmuted", "muted"],
		camera: ["on", "off"],
		backgroundBlur: ["on", "off"],
		hand: ["lowered", "raised"],
	};
	if (value === mappings[field][0]) return 0;
	if (value === mappings[field][1]) return 1;
	return undefined;
}

/**
 * True, after logging, when a key press must do nothing because no Teams meeting
 * is active. Only key-down presses check this: a release always runs, so Push
 * to Talk still mutes and an armed Leave still disarms.
 */
export function pressIgnored(): boolean {
	if (meetingActivity.active) return false;
	streamDeck.logger.info("Ignored a key press because no Teams meeting is active.");
	return true;
}

class StateSynchronizer {
	private readonly keys = new Map<string, RegisteredKey>();
	private refreshPromise: Promise<void> | undefined;
	private blur: BlurState = "unknown";
	latest: TeamsState | undefined;

	constructor() {
		persistentControls.subscribe(state => {
			if (!operationLock.busy) void this.apply(state, "status");
		});
		meetingActivity.confirmWith(() => {
			void this.refresh().catch(() => streamDeck.logger.warn("Teams meeting status confirmation failed."));
		});
	}

	get hasVisibleControls(): boolean {
		return this.keys.size > 0;
	}

	/** Registers a key, or updates its look, and draws it. */
	register(context: string, action: KeyAction, look: KeyLook): Promise<void> {
		this.keys.set(context, { ...look, action });
		persistentControls.retain(context);
		return this.render(this.keys.get(context) as RegisteredKey);
	}

	unregister(context: string): void {
		this.keys.delete(context);
		persistentControls.release(context);
		if (!this.hasVisibleControls) this.latest = undefined;
	}

	disconnectDevice(deviceID: string): void {
		for (const [context, key] of this.keys) {
			if (key.action.device.id === deviceID) this.unregister(context);
		}
	}

	/** Reads status now. A failed read counts as unknown, which keeps keys live. */
	async refresh(): Promise<void> {
		if (this.refreshPromise) return this.refreshPromise;
		this.refreshPromise = (async () => {
			try {
				const execution = await commandCoordinator.execute("status");
				if (execution.status === "completed") await this.apply(execution.result, "status");
			} catch (error) {
				await this.report(() => meetingActivity.reportStatus(undefined), false);
				throw error;
			} finally {
				this.refreshPromise = undefined;
			}
		})();
		return this.refreshPromise;
	}

	/** Takes a status read or a command result and redraws the keys. Only a status read can make keys inactive. */
	async apply(reported: TeamsState, origin: "status" | "command" = "command"): Promise<void> {
		this.blur = stickyBlur(this.blur, reported.backgroundBlur);
		this.latest = { ...reported, backgroundBlur: this.blur };
		await this.report(() => {
			if (origin === "status") meetingActivity.reportStatus(reported);
			else meetingActivity.reportCommandResult(reported);
		}, true);
	}

	/**
	 * Applies an activity update. State keys redraw after every result; other keys
	 * only when activity changes, so an armed Leave image survives status pushes.
	 */
	private async report(update: () => void, stateChanged: boolean): Promise<void> {
		const before = meetingActivity.active;
		update();
		const activityChanged = meetingActivity.active !== before;
		const keys = [...this.keys.values()].filter(key => activityChanged || (stateChanged && key.field));
		await Promise.allSettled(keys.map(key => this.render(key)));
	}

	/** Inactive first, then a known state, then the unknown or unavailable image. */
	private async render(key: RegisteredKey): Promise<void> {
		const { action } = key;
		try {
			if (!meetingActivity.active) {
				await action.setImage(inactiveKeyImage(key.restingImage));
			} else if (!key.field) {
				await action.setImage(key.image);
			} else {
				await this.renderState(action, key.field);
			}
		} catch {
			streamDeck.logger.warn("Could not update a Teams key image.");
		}
	}

	private async renderState(action: KeyAction, field: StateField): Promise<void> {
		const value = this.latest?.[field] ?? "unavailable";
		const index = stateIndex(field, value);
		if (index === undefined) {
			await action.setImage(value === "unavailable" ? UNAVAILABLE_IMAGE : UNKNOWN_IMAGE);
			return;
		}
		await action.setState(index);
		await action.setImage();
	}
}

export const stateSynchronizer = new StateSynchronizer();
