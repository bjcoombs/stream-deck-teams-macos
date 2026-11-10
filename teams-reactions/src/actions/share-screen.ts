import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import { commandCoordinator } from "../teams-services";
import { logHelperError, ToggleCallControlAction } from "./call-controls";
import { pressAllowed, stateSynchronizer } from "./state-synchronizer";

/**
 * Starts or stops screen sharing. While not sharing, a press opens the Teams share
 * picker and leaves the choice of screen or window to the user; the key shows
 * sharing once Teams reports Stop sharing. While sharing, a press stops sharing.
 * The helper reads the share state at press time, so every press sends
 * share-toggle, including inside a Multi Action.
 */
@action({ UUID: "com.laurens-bolle.teams-reactions.share" })
export class ShareScreenAction extends ToggleCallControlAction {
	protected readonly field = "screenShare" as const;
	protected readonly commands = ["share-toggle", "share-toggle"] as const;
	protected readonly restingImage = "imgs/actions/share/off";

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!(await pressAllowed())) return;
		try {
			const execution = await commandCoordinator.execute("share-toggle");
			if (execution.status === "busy") {
				streamDeck.logger.warn("Ignored share-toggle because another Teams operation is running.");
				await ev.action.showAlert();
				return;
			}
			const { changed, screenShare } = execution.result;
			await stateSynchronizer.apply(execution.result);
			streamDeck.logger.info(`Teams command completed: share-toggle; screenShare=${screenShare}; changed=${changed}.`);
			await ev.action.showOk();
		} catch (error) {
			logHelperError("Teams command share-toggle", error);
			await ev.action.showAlert();
		}
	}
}
