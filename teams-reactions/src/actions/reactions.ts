import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { Reaction } from "../helper-runner";
import { ReactionKeyController, reactionFromSettings, reactionKeyImage } from "../reaction-key";
import { reactionCoordinator } from "../teams-services";
import { logHelperError, refreshForKey } from "./call-controls";
import { keyActionFromEvent, pressAllowed, stateSynchronizer } from "./state-synchronizer";

const reactionKeyController = new ReactionKeyController({
	sendOnce: reaction => reactionCoordinator.execute(reaction),
}, {
	info: message => streamDeck.logger.info(message),
	warn: message => streamDeck.logger.warn(message),
	reportError: logHelperError,
});

/** Shared key handling. Subclasses decide which reaction a press sends and how the key looks. */
abstract class ReactionKeyAction extends SingletonAction {
	/** Read on every press: a SingletonAction serves every key with its UUID. */
	protected abstract reactionFor(settings: unknown): Reaction;
	/** The image the key shows while a meeting is active; undefined keeps the manifest image. */
	protected abstract liveImage(reaction: Reaction): string | undefined;

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!(await pressAllowed())) return;
		await reactionKeyController.keyDown(ev.action, this.reactionFor(ev.payload.settings));
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!keyActionFromEvent(ev)) return;
		await this.show(ev);
		await refreshForKey("Reaction");
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		stateSynchronizer.unregister(ev.action.id);
	}

	protected async show(ev: WillAppearEvent | DidReceiveSettingsEvent): Promise<void> {
		const actionInstance = keyActionFromEvent(ev);
		if (!actionInstance) return;
		const reaction = this.reactionFor(ev.payload.settings);
		await stateSynchronizer.register(actionInstance.id, actionInstance, {
			image: this.liveImage(reaction),
			restingImage: reactionKeyImage(reaction),
		});
	}
}

/** A key that always sends one reaction. Hidden from the action list; kept so existing keys work. */
abstract class FixedReactionAction extends ReactionKeyAction {
	private readonly reaction: Reaction;

	protected constructor(reaction: Reaction) {
		super();
		this.reaction = reaction;
	}

	protected override reactionFor(): Reaction {
		return this.reaction;
	}

	protected override liveImage(): undefined {
		return undefined;
	}
}

/** One key whose Property Inspector chooses the reaction; the key image follows the choice. */
@action({ UUID: "com.laurens-bolle.teams-reactions.reaction" })
export class ReactionPickerAction extends ReactionKeyAction {
	protected override reactionFor(settings: unknown): Reaction {
		return reactionFromSettings(settings);
	}

	protected override liveImage(reaction: Reaction): string {
		return reactionKeyImage(reaction);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
		return this.show(ev);
	}
}

@action({ UUID: "com.laurens-bolle.teams-reactions.like" })
export class LikeAction extends FixedReactionAction {
	constructor() { super("like"); }
}

@action({ UUID: "com.laurens-bolle.teams-reactions.love" })
export class LoveAction extends FixedReactionAction {
	constructor() { super("love"); }
}

@action({ UUID: "com.laurens-bolle.teams-reactions.applause" })
export class ApplauseAction extends FixedReactionAction {
	constructor() { super("applause"); }
}

@action({ UUID: "com.laurens-bolle.teams-reactions.laugh" })
export class LaughAction extends FixedReactionAction {
	constructor() { super("laugh"); }
}

@action({ UUID: "com.laurens-bolle.teams-reactions.surprise" })
export class SurpriseAction extends FixedReactionAction {
	constructor() { super("surprise"); }
}
