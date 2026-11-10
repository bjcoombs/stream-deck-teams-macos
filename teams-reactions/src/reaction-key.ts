/**
 * Reaction key behavior, free of the Stream Deck SDK so tests can load it directly.
 * The fixed reaction keys and the Reaction picker key share this one press path;
 * they differ only in how they choose the reaction.
 */
import type { BurstResult, Reaction } from "./helper-runner";

/** The reaction a picker key sends when its settings name none, or an unknown one. */
export const DEFAULT_REACTION: Reaction = "like";

/**
 * Every reaction a picker key may select. Typed as a record over Reaction so the
 * compiler rejects a reaction added to helper-runner.ts but missing here.
 */
const PICKER_REACTIONS: Readonly<Record<Reaction, Reaction>> = { like: "like", love: "love", applause: "applause", laugh: "laugh", surprise: "surprise" };

/** Reads the reaction a Reaction picker key's settings select, falling back to Like. */
export function reactionFromSettings(settings: unknown): Reaction {
	if (typeof settings !== "object" || settings === null) return DEFAULT_REACTION;
	const reaction = (settings as { reaction?: unknown }).reaction;
	return typeof reaction === "string" && Object.hasOwn(PICKER_REACTIONS, reaction) ? PICKER_REACTIONS[reaction as Reaction] : DEFAULT_REACTION;
}

/** The plugin-relative key image for a reaction, without extension so Stream Deck picks the @2x file. */
export function reactionKeyImage(reaction: Reaction): string {
	return `imgs/actions/${reaction}/key`;
}

export type ReactionKey = {
	readonly id: string;
	showOk(): Promise<void>;
	showAlert(): Promise<void>;
};

export type ReactionKeyServices = {
	startBurst(id: string, reaction: Reaction): { status: "busy" } | { status: "started"; completion: Promise<BurstResult> };
	stopBurst(id: string): void;
	sendOnce(reaction: Reaction): Promise<{ status: "busy" } | { status: string }>;
};

export type ReactionKeyLogger = {
	info(message: string): void;
	warn(message: string): void;
	reportError(operation: string, error: unknown): void;
};

export class ReactionKeyController {
	private readonly services: ReactionKeyServices;
	private readonly logger: ReactionKeyLogger;

	constructor(services: ReactionKeyServices, logger: ReactionKeyLogger) {
		this.services = services;
		this.logger = logger;
	}

	/** Starts a reaction wave, or sends once inside a Multi Action. */
	async keyDown(key: ReactionKey, reaction: Reaction, isInMultiAction: boolean): Promise<void> {
		if (isInMultiAction) {
			await this.sendSingleReaction(key, reaction);
			return;
		}

		try {
			const started = this.services.startBurst(key.id, reaction);
			if (started.status === "busy") {
				this.logger.warn(`Ignored ${reaction} because another Teams operation is running.`);
				await key.showAlert();
				return;
			}
			// The key can be gone by the time the wave ends, so a failed status indicator is only logged.
			void this.reportBurst(started.completion, key, reaction)
				.catch(() => this.logger.warn(`Could not show the result of the ${reaction} reaction wave.`));
		} catch (error) {
			this.logger.reportError(`Teams reaction burst ${reaction}`, error);
			await key.showAlert();
		}
	}

	/** Ends the key's reaction wave on release or when the key disappears. */
	release(id: string): void {
		this.services.stopBurst(id);
	}

	private async sendSingleReaction(key: ReactionKey, reaction: Reaction): Promise<void> {
		try {
			const execution = await this.services.sendOnce(reaction);
			if (execution.status === "busy") {
				this.logger.warn(`Ignored ${reaction} because another Teams operation is running.`);
				await key.showAlert();
				return;
			}
			this.logger.info(`Sent one Teams reaction command: ${reaction}.`);
			await key.showOk();
		} catch (error) {
			this.logger.reportError(`Teams reaction ${reaction}`, error);
			await key.showAlert();
		}
	}

	private async reportBurst(completion: Promise<BurstResult>, key: ReactionKey, reaction: Reaction): Promise<void> {
		try {
			const result = await completion;
			this.logger.info(
				`Teams reaction burst ${result.reaction}: attempted=${result.attempted}, accepted=${result.accessibilityAccepted}, elapsedMs=${result.elapsedMs}, stop=${result.stopReason}.`,
			);
			if (result.accessibilityAccepted > 0) await key.showOk();
			else await key.showAlert();
		} catch (error) {
			this.logger.reportError(`Teams reaction burst ${reaction}`, error);
			await key.showAlert();
		}
	}
}
