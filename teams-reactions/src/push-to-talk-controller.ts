/**
 * Push to Talk key behavior, free of the Stream Deck SDK so tests can load it directly.
 * Key-down unmutes only a muted microphone; key-up mutes again only if this key
 * unmuted it. Every uncertain outcome leans towards muting on release.
 */

/** Delay between attempts when the release mute meets another Teams operation. */
export const MUTE_RETRY_MS = 250;
/** Attempts before a release mute that keeps meeting the operation lock gives up. */
export const MUTE_ATTEMPTS = 20;

export type PushToTalkKey = {
	readonly id: string;
	showAlert(): Promise<void>;
};

export type MicrophoneCommandResult =
	| { status: "busy" }
	| { status: "completed"; microphone: string; changed: boolean };

export type PushToTalkServices = {
	/** The microphone state Teams reports now: "muted", "unmuted", or anything else for unknown. */
	readMicrophone(): Promise<string | undefined>;
	execute(command: "mute" | "unmute"): Promise<MicrophoneCommandResult>;
	wait(ms: number): Promise<void>;
};

export type PushToTalkLogger = {
	info(message: string): void;
	warn(message: string): void;
	reportError(operation: string, error: unknown): void;
};

type Hold = {
	readonly key: PushToTalkKey;
	/** Resolves true when this key may have unmuted the microphone and must mute it again. */
	ownsUnmute: Promise<boolean>;
};

export class PushToTalkController {
	private readonly services: PushToTalkServices;
	private readonly logger: PushToTalkLogger;
	private readonly holds = new Map<string, Hold>();
	private settling: Promise<void> = Promise.resolve();

	constructor(services: PushToTalkServices, logger: PushToTalkLogger) {
		this.services = services;
		this.logger = logger;
	}

	async keyDown(key: PushToTalkKey, isInMultiAction: boolean): Promise<void> {
		if (isInMultiAction) {
			this.logger.warn("Ignored Push to Talk inside a multi-action because it requires a held key.");
			await this.alert(key);
			return;
		}
		if (this.holds.has(key.id)) return;
		const hold: Hold = { key, ownsUnmute: Promise.resolve(false) };
		this.holds.set(key.id, hold);
		hold.ownsUnmute = this.unmute(hold);
		await hold.ownsUnmute;
	}

	keyUp(key: PushToTalkKey): Promise<void> {
		return this.release(key.id);
	}

	/** A key that disappears while held mutes as if it were released. */
	disappear(id: string): Promise<void> {
		return this.release(id);
	}

	/** Mutes for every held key that unmuted, for device disconnect and system wake. */
	async releaseAll(): Promise<void> {
		await Promise.all([...this.holds.keys()].map(id => this.release(id)));
	}

	private release(id: string): Promise<void> {
		const hold = this.holds.get(id);
		if (!hold) return this.settling;
		this.holds.delete(id);
		const done = this.settling.then(() => this.finish(hold));
		this.settling = done;
		return done;
	}

	private async finish(hold: Hold): Promise<void> {
		if (await hold.ownsUnmute) await this.muteAgain(hold.key);
	}

	private async unmute(hold: Hold): Promise<boolean> {
		await this.settling;
		const state = await this.read(hold.key);
		if (state === undefined) return false;
		if (state === "unmuted") {
			this.logger.info("Push to Talk left the microphone alone because it was already unmuted.");
			return false;
		}
		if (this.holds.get(hold.key.id) !== hold) return false;
		return this.sendUnmute(hold.key);
	}

	private async read(key: PushToTalkKey): Promise<"muted" | "unmuted" | undefined> {
		let state: string | undefined;
		try {
			state = await this.services.readMicrophone();
		} catch (error) {
			this.logger.reportError("Push to Talk microphone state", error);
		}
		if (state === "muted" || state === "unmuted") return state;
		this.logger.warn("Push to Talk did not unmute because the microphone state is unknown.");
		await this.alert(key);
		return undefined;
	}

	private async sendUnmute(key: PushToTalkKey): Promise<boolean> {
		let result: MicrophoneCommandResult;
		try {
			result = await this.services.execute("unmute");
		} catch (error) {
			// The press may have reached Teams before the failure, so mute on release.
			this.logger.reportError("Teams command unmute", error);
			await this.alert(key);
			return true;
		}
		if (result.status === "busy") {
			this.logger.warn("Ignored Push to Talk because another Teams operation is running.");
			await this.alert(key);
			return false;
		}
		if (result.microphone !== "unmuted") {
			this.logger.warn("Teams command unmute was accepted without confirmed state.");
			await this.alert(key);
			return true;
		}
		if (!result.changed) {
			this.logger.info("Push to Talk found the microphone already unmuted, so release will not mute it.");
			return false;
		}
		this.logger.info("Push to Talk unmuted the microphone.");
		return true;
	}

	private async muteAgain(key: PushToTalkKey): Promise<void> {
		for (let attempt = 1; attempt <= MUTE_ATTEMPTS; attempt += 1) {
			let result: MicrophoneCommandResult;
			try {
				result = await this.services.execute("mute");
			} catch (error) {
				this.logger.reportError("Teams command mute", error);
				await this.alert(key);
				return;
			}
			if (result.status === "completed") {
				if (result.microphone === "muted") {
					this.logger.info("Push to Talk muted the microphone again.");
					return;
				}
				this.logger.warn("Teams command mute was accepted without confirmed state.");
				await this.alert(key);
				return;
			}
			if (attempt < MUTE_ATTEMPTS) await this.services.wait(MUTE_RETRY_MS);
		}
		this.logger.warn(`Push to Talk could not mute: another Teams operation held the lock for ${MUTE_ATTEMPTS} attempts.`);
		await this.alert(key);
	}

	/** Shows the alert, logs a failure and never rejects. */
	private async alert(key: PushToTalkKey): Promise<void> {
		try {
			await key.showAlert();
		} catch {
			this.logger.warn("Could not show the Push to Talk alert.");
		}
	}
}
