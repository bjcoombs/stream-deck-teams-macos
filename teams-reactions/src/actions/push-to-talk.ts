import streamDeck, {
	action,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { type MicrophoneCommandResult, PushToTalkController } from "../push-to-talk-controller";
import { commandCoordinator } from "../teams-services";
import { logHelperError, refreshForKey } from "./call-controls";
import { keyActionFromEvent, keyReleased, pressAllowed, stateSynchronizer } from "./state-synchronizer";

function knownMicrophone(): string | undefined {
	const microphone = stateSynchronizer.latest?.microphone;
	return microphone === "muted" || microphone === "unmuted" ? microphone : undefined;
}

async function readMicrophone(): Promise<string | undefined> {
	if (knownMicrophone()) return knownMicrophone();
	await stateSynchronizer.refresh();
	return stateSynchronizer.latest?.microphone;
}

async function executeMicrophone(command: "mute" | "unmute"): Promise<MicrophoneCommandResult> {
	const execution = await commandCoordinator.execute(command);
	if (execution.status === "busy") return { status: "busy" };
	await stateSynchronizer.apply(execution.result);
	return { status: "completed", microphone: execution.result.microphone, changed: execution.result.changed };
}

const pushToTalkController = new PushToTalkController({
	readMicrophone,
	execute: executeMicrophone,
	wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
}, {
	info: message => streamDeck.logger.info(message),
	warn: message => streamDeck.logger.warn(message),
	reportError: logHelperError,
});

/** Mutes again for every held Push to Talk key that unmuted, for device disconnect and system wake. */
export function releaseAllPushToTalk(): Promise<void> {
	return pushToTalkController.releaseAll();
}

/** Hold to unmute; release to mute again. The key shows the microphone state Teams reports. */
@action({ UUID: "com.laurens-bolle.teams-reactions.push-to-talk" })
export class PushToTalkAction extends SingletonAction {
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!(await pressAllowed(ev.action.id))) return;
		await pushToTalkController.keyDown(ev.action, ev.payload.isInMultiAction);
	}

	/** Never gated: a release must mute again even if the meeting ended during the hold. */
	override onKeyUp(ev: KeyUpEvent): Promise<void> {
		keyReleased(ev.action.id);
		return pushToTalkController.keyUp(ev.action);
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		const actionInstance = keyActionFromEvent(ev);
		if (!actionInstance) return;
		await stateSynchronizer.register(actionInstance.id, actionInstance, { field: "microphone", restingImage: "imgs/actions/push-to-talk/muted" });
		await refreshForKey("Push to Talk");
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		void pushToTalkController.disappear(ev.action.id);
		stateSynchronizer.unregister(ev.action.id);
	}
}
