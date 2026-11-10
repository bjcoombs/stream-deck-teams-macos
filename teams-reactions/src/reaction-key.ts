/**
 * Reaction key behavior, free of the Stream Deck SDK so tests can load it directly.
 * The fixed reaction keys and the Reaction picker key share this one press path;
 * they differ only in how they choose the reaction. Teams has no hold-to-repeat
 * reaction, so every press sends exactly one, whether tapped or held.
 */
import type { Reaction } from "./helper-runner";

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
	showOk(): Promise<void>;
	showAlert(): Promise<void>;
};

export type ReactionKeyServices = {
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

	/** Sends one reaction. A key release does nothing. */
	async keyDown(key: ReactionKey, reaction: Reaction): Promise<void> {
		try {
			const execution = await this.services.sendOnce(reaction);
			if (execution.status === "busy") {
				this.logger.warn(`Ignored ${reaction} because another Teams operation is running.`);
				await this.show(key, "showAlert", reaction);
				return;
			}
			this.logger.info(`Sent one Teams reaction command: ${reaction}.`);
			await this.show(key, "showOk", reaction);
		} catch (error) {
			this.logger.reportError(`Teams reaction ${reaction}`, error);
			await this.show(key, "showAlert", reaction);
		}
	}

	/** The key can be gone by the time the reaction ends, so a failed indicator is only logged. */
	private async show(key: ReactionKey, indicator: "showOk" | "showAlert", reaction: Reaction): Promise<void> {
		try {
			await key[indicator]();
		} catch {
			this.logger.warn(`Could not show the result of the ${reaction} reaction.`);
		}
	}
}
