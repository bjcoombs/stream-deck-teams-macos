import streamDeck, {
	action,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { type MicrophoneCommandResult, PushToTalkController } from "../push-to-talk-controller";
import { commandCoordinator } from "../teams-services";
import { logHelperError, stateSynchronizer } from "./call-controls";

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
	override onKeyDown(ev: KeyDownEvent): Promise<void> {
		return pushToTalkController.keyDown(ev.action, ev.payload.isInMultiAction);
	}

	override onKeyUp(ev: KeyUpEvent): Promise<void> {
		return pushToTalkController.keyUp(ev.action);
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!("setState" in ev.action)) return;
		stateSynchronizer.register(ev.action.id, "microphone", ev.action as KeyAction);
		try {
			await stateSynchronizer.refresh();
		} catch (error) {
			logHelperError("Push to Talk state refresh", error);
		}
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		void pushToTalkController.disappear(ev.action.id);
		stateSynchronizer.unregister(ev.action.id, "microphone");
	}
}
