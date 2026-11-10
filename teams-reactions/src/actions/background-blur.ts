import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { commandCoordinator } from "../teams-services";
import { logHelperError, ToggleCallControlAction } from "./call-controls";
import { pressIgnored, stateSynchronizer } from "./state-synchronizer";

/**
 * Turns Teams background blur on or off. Teams shows the current blur only inside
 * its video effects panel, so a key press sends blur-toggle, which opens the
 * panel, reads the selection, picks the other option and closes the panel.
 * Multi-actions keep the explicit blur-on and blur-off commands.
 */
@action({ UUID: "com.laurens-bolle.teams-reactions.blur" })
export class BackgroundBlurAction extends ToggleCallControlAction {
	protected readonly field = "backgroundBlur" as const;
	protected readonly commands = ["blur-on", "blur-off"] as const;
	protected readonly restingImage = "imgs/actions/blur/off";

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (ev.payload.isInMultiAction) {
			return super.onKeyDown(ev);
		}
		if (pressIgnored()) return;
		try {
			const execution = await commandCoordinator.execute("blur-toggle");
			if (execution.status === "busy") {
				streamDeck.logger.warn("Ignored blur-toggle because another Teams operation is running.");
				await ev.action.showAlert();
				return;
			}
			const blur = execution.result.backgroundBlur;
			await stateSynchronizer.apply(execution.result);
			if (blur === "on" || blur === "off") {
				streamDeck.logger.info(`Teams command completed: blur-toggle; blur=${blur}.`);
				await ev.action.showOk();
			} else {
				streamDeck.logger.warn(`Teams command blur-toggle could not confirm the blur state (${blur}).`);
				await ev.action.showAlert();
			}
		} catch (error) {
			logHelperError("Teams command blur-toggle", error);
			await ev.action.showAlert();
		}
	}
}
