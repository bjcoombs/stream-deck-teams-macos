import { action } from "@elgato/streamdeck";

import { ToggleCallControlAction } from "./call-controls";

/** Turns Teams background blur on or off, reflecting the state Teams reports. */
@action({ UUID: "com.laurens-bolle.teams-reactions.blur" })
export class BackgroundBlurAction extends ToggleCallControlAction {
	protected readonly field = "backgroundBlur" as const;
	protected readonly commands = ["blur-on", "blur-off"] as const;
}
