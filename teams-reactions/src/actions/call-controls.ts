import streamDeck, {
	action,
	type KeyDownEvent,
	type KeyUpEvent,
	type State,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { HelperExecutionError, type TeamsCommand } from "../helper-runner";
import { HoldGate } from "../hold-gate";
import { LEAVE_HOLD_MS, LeaveController } from "../leave-controller";
import { commandCoordinator } from "../teams-services";
import { keyActionFromEvent, keyReleased, pressAllowed, type StateField, stateIndex, stateSynchronizer } from "./state-synchronizer";

export abstract class ToggleCallControlAction extends SingletonAction {
	protected abstract readonly field: StateField;
	protected abstract readonly commands: readonly [TeamsCommand, TeamsCommand];
	/** The key image whose dimmed twin shows while no meeting is active. */
	protected abstract readonly restingImage: string;

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		const actionInstance = keyActionFromEvent(ev);
		if (!actionInstance) return;
		await stateSynchronizer.register(actionInstance.id, actionInstance, { field: this.field, restingImage: this.restingImage });
		await refreshForKey(this.field);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		stateSynchronizer.unregister(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!(await pressAllowed())) return;
		let desiredIndex: State;
		if (ev.payload.isInMultiAction) {
			desiredIndex = ev.payload.userDesiredState;
		} else {
			let currentIndex = stateSynchronizer.latest ? stateIndex(this.field, stateSynchronizer.latest[this.field]) : undefined;
			if (currentIndex === undefined) {
				await refreshForKey(this.field);
				currentIndex = stateSynchronizer.latest ? stateIndex(this.field, stateSynchronizer.latest[this.field]) : undefined;
			}
			if (currentIndex === undefined) {
				await ev.action.showAlert();
				return;
			}
			desiredIndex = currentIndex === 0 ? 1 : 0;
		}

		const command = this.commands[desiredIndex];
		try {
			const execution = await commandCoordinator.execute(command);
			if (execution.status === "busy") {
				streamDeck.logger.warn(`Ignored ${command} because another Teams operation is running.`);
				await ev.action.showAlert();
				return;
			}
			const result = execution.result;
			const confirmedIndex = stateIndex(this.field, result[this.field]);
			await stateSynchronizer.apply(result);
			if (confirmedIndex === desiredIndex) {
				streamDeck.logger.info(`Teams command completed: ${command}; changed=${result.changed}.`);
				await ev.action.showOk();
			} else {
				streamDeck.logger.warn(`Teams command ${command} was accepted without confirmed state.`);
				await ev.action.showAlert();
			}
		} catch (error) {
			logHelperError(`Teams command ${command}`, error);
			await ev.action.showAlert();
		}
	}
}

/** Reads Teams status for a key that just appeared; a failure is logged and leaves the key live. */
export async function refreshForKey(name: string): Promise<void> {
	try {
		await stateSynchronizer.refresh();
	} catch (error) {
		logHelperError(`${name} state refresh`, error);
	}
}

export function logHelperError(operation: string, error: unknown): void {
	if (error instanceof HelperExecutionError) {
		const exitCode = error.exitCode === null ? "unavailable" : String(error.exitCode);
		streamDeck.logger.error(`${operation} failed (exit code ${exitCode}): ${error.diagnostic}`);
	} else {
		streamDeck.logger.error(`${operation} failed with an unexpected plugin error.`);
	}
}

@action({ UUID: "com.laurens-bolle.teams-reactions.mute" })
export class MuteAction extends ToggleCallControlAction {
	protected readonly field = "microphone" as const;
	protected readonly commands = ["unmute", "mute"] as const;
	protected readonly restingImage = "imgs/actions/mute/muted";
}

@action({ UUID: "com.laurens-bolle.teams-reactions.camera" })
export class CameraAction extends ToggleCallControlAction {
	protected readonly field = "camera" as const;
	protected readonly commands = ["camera-on", "camera-off"] as const;
	protected readonly restingImage = "imgs/actions/camera/off";
}

@action({ UUID: "com.laurens-bolle.teams-reactions.hand" })
export class HandAction extends ToggleCallControlAction {
	protected readonly field = "hand" as const;
	protected readonly commands = ["hand-lower", "hand-raise"] as const;
	protected readonly restingImage = "imgs/actions/hand/lowered";
}

async function executeLeave(): Promise<{ status: "completed" | "busy" }> {
	const execution = await commandCoordinator.execute("leave");
	if (execution.status === "completed") await stateSynchronizer.apply(execution.result);
	return { status: execution.status };
}

const leaveController = new LeaveController(executeLeave, {
	info: message => streamDeck.logger.info(message),
	warn: message => streamDeck.logger.warn(message),
	reportError: logHelperError,
}, new HoldGate(LEAVE_HOLD_MS));

/** Disarms any pending Leave and restores its key image, for device disconnect and system wake. */
export function cancelPendingLeave(): void {
	leaveController.cancelAll();
}

@action({ UUID: "com.laurens-bolle.teams-reactions.leave" })
export class LeaveAction extends SingletonAction {
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!(await pressAllowed(ev.action.id))) return;
		await leaveController.keyDown(ev.action, ev.payload.isInMultiAction);
	}

	override onKeyUp(ev: KeyUpEvent): Promise<void> {
		keyReleased(ev.action.id);
		return leaveController.keyUp(ev.action);
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		const actionInstance = keyActionFromEvent(ev);
		if (!actionInstance) return;
		await leaveController.appear(actionInstance);
		await stateSynchronizer.register(actionInstance.id, actionInstance, { restingImage: "imgs/actions/leave/leave" });
		await refreshForKey("Leave");
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		leaveController.disappear(ev.action.id);
		stateSynchronizer.unregister(ev.action.id);
	}
}
