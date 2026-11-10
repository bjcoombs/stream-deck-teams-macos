import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { Reaction } from "../helper-runner";
import { ReactionKeyController, reactionFromSettings, reactionKeyImage } from "../reaction-key";
import { reactionBurstCoordinator, reactionCoordinator } from "../teams-services";
import { logHelperError } from "./call-controls";

const reactionKeyController = new ReactionKeyController({
	startBurst: (id, reaction) => reactionBurstCoordinator.start(id, reaction),
	stopBurst: id => reactionBurstCoordinator.stop(id),
	sendOnce: reaction => reactionCoordinator.execute(reaction),
}, {
	info: message => streamDeck.logger.info(message),
	warn: message => streamDeck.logger.warn(message),
	reportError: logHelperError,
});

/** Shared key handling. Subclasses decide which reaction a press sends. */
abstract class ReactionKeyAction extends SingletonAction {
	/** Read on every press: a SingletonAction serves every key with its UUID. */
	protected abstract reactionFor(ev: KeyDownEvent): Reaction;

	override onKeyDown(ev: KeyDownEvent): Promise<void> {
		return reactionKeyController.keyDown(ev.action, this.reactionFor(ev), ev.payload.isInMultiAction);
	}

	override onKeyUp(ev: KeyUpEvent): void {
		reactionKeyController.release(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		reactionKeyController.release(ev.action.id);
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
}

/** One key whose Property Inspector chooses the reaction; the key image follows the choice. */
@action({ UUID: "com.laurens-bolle.teams-reactions.reaction" })
export class ReactionPickerAction extends ReactionKeyAction {
	protected override reactionFor(ev: KeyDownEvent): Reaction {
		return reactionFromSettings(ev.payload.settings);
	}

	override onWillAppear(ev: WillAppearEvent): Promise<void> {
		return this.showReaction(ev);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
		return this.showReaction(ev);
	}

	private async showReaction(ev: WillAppearEvent | DidReceiveSettingsEvent): Promise<void> {
		if (!ev.action.isKey()) return;
		try {
			await ev.action.setImage(reactionKeyImage(reactionFromSettings(ev.payload.settings)));
		} catch {
			streamDeck.logger.warn("Could not update the Reaction key image.");
		}
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
