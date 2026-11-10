/**
 * Leave Call key behavior, free of the Stream Deck SDK so tests can load it directly.
 * The held key is the user's intent: a failed image update is logged and never
 * cancels or blocks the Leave.
 */
import type { HoldGate } from "./hold-gate";

/** Helper exit code when the toolbar Leave opened the Teams leave-while-sharing dialogue. */
export const LEAVE_CONFIRMATION_EXIT_CODE = 15;

/** Matches the helper error for that exit code without importing the helper runner, so tests load this module alone. */
function asksToConfirm(error: unknown): boolean {
	return typeof error === "object" && error !== null && "exitCode" in error && error.exitCode === LEAVE_CONFIRMATION_EXIT_CODE;
}

/** Leave runs only after the key has been held this long. A tap never leaves. */
export const LEAVE_HOLD_MS = 1_500;
export const LEAVE_ARMED_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="22" fill="#b3261e"/><text x="72" y="66" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#ffffff">HOLD</text><text x="72" y="104" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#ffffff">TO LEAVE</text></svg>`;

export type LeaveKey = {
	readonly id: string;
	setImage(image?: string): Promise<void>;
	showAlert(): Promise<void>;
	showOk(): Promise<void>;
};

export type LeaveExecute = () => Promise<{ status: "completed" | "busy" }>;

/**
 * Presses Stay in the dialogue Teams shows when you leave while sharing. "none"
 * means no dialogue was open, so the tap is an ordinary cancelled Leave.
 */
export type LeaveStay = () => Promise<"stayed" | "none" | "busy">;

export type LeaveLogger = {
	info(message: string): void;
	warn(message: string): void;
	reportError(operation: string, error: unknown): void;
};

export class LeaveController {
	private readonly execute: LeaveExecute;
	private readonly logger: LeaveLogger;
	private readonly gate: HoldGate;
	private readonly stayInDialog: LeaveStay;
	private readonly armedKeys = new Map<string, LeaveKey>();

	constructor(execute: LeaveExecute, logger: LeaveLogger, gate: HoldGate, stayInDialog: LeaveStay = async () => "none") {
		this.execute = execute;
		this.logger = logger;
		this.gate = gate;
		this.stayInDialog = stayInDialog;
	}

	async keyDown(key: LeaveKey, isInMultiAction: boolean): Promise<void> {
		if (isInMultiAction) {
			this.logger.warn("Ignored leave inside a multi-action because Leave requires a held key.");
			await this.alert(key);
			return;
		}
		const armed = this.gate.press(key.id, () => {
			this.armedKeys.delete(key.id);
			void this.leave(key);
		});
		if (!armed) return;
		this.armedKeys.set(key.id, key);
		await this.safe(() => key.setImage(LEAVE_ARMED_IMAGE), "show the armed Leave image");
	}

	/** A tap cancels the Leave, and answers Stay if Teams is asking whether to leave while sharing. */
	async keyUp(key: LeaveKey): Promise<void> {
		if (!this.disarm(key.id)) return;
		if (await this.stay(key)) return;
		this.logger.info(`Leave cancelled: the key was released before ${LEAVE_HOLD_MS} ms.`);
		await this.alert(key);
	}

	/** Clears a stale armed image left by a reload or a missed key-up. */
	async appear(key: LeaveKey): Promise<void> {
		await this.safe(() => key.setImage(), "clear the Leave key image");
	}

	disappear(id: string): void {
		this.disarm(id);
	}

	/** Disarms every pending Leave and restores its key image, for device disconnect and system wake. */
	cancelAll(): void {
		for (const id of [...this.armedKeys.keys()]) this.disarm(id);
		this.gate.cancelAll();
	}

	private disarm(id: string): boolean {
		const key = this.armedKeys.get(id);
		this.armedKeys.delete(id);
		const cancelled = this.gate.release(id) === "cancelled";
		if (key) void this.safe(() => key.setImage(), "restore the Leave key image after disarming");
		return cancelled;
	}

	private async leave(key: LeaveKey): Promise<void> {
		await this.safe(() => key.setImage(), "restore the Leave key image");
		let status: "completed" | "busy" | "confirm";
		try {
			({ status } = await this.execute());
		} catch (error) {
			if (!asksToConfirm(error)) {
				this.logger.reportError("Teams command leave", error);
				await this.alert(key);
				return;
			}
			status = "confirm";
		}
		if (status === "confirm") {
			this.logger.info("Teams is asking to confirm leaving while sharing; hold again to leave or tap to stay.");
			await this.alert(key);
			return;
		}
		if (status === "busy") {
			this.logger.warn("Ignored leave because another Teams operation is running.");
			await this.alert(key);
			return;
		}
		this.logger.info("Teams meeting leave completed.");
		await this.safe(() => key.showOk(), "show the Leave confirmation");
	}

	private async stay(key: LeaveKey): Promise<boolean> {
		let outcome: "stayed" | "none" | "busy";
		try {
			outcome = await this.stayInDialog();
		} catch (error) {
			this.logger.reportError("Teams command leave-stay", error);
			return false;
		}
		if (outcome === "busy") this.logger.warn("Could not press Stay because another Teams operation is running.");
		if (outcome !== "stayed") return false;
		this.logger.info("Stayed in the meeting: pressed Stay in the Teams leave-while-sharing dialogue.");
		await this.safe(() => key.showOk(), "show the Stay confirmation");
		return true;
	}

	private alert(key: LeaveKey): Promise<void> {
		return this.safe(() => key.showAlert(), "show the Leave alert");
	}

	/** Runs a key update, logs a failure and never rejects. */
	private async safe(update: () => Promise<unknown>, context: string): Promise<void> {
		try {
			await update();
		} catch {
			this.logger.warn(`Could not ${context}.`);
		}
	}
}
