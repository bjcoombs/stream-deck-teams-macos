import {
	CommandCoordinator,
	OperationLock,
	PersistentControlClient,
	ReactionCoordinator,
	isPersistentCommand,
	runReactionHelper,
	runTeamsCommand,
} from "./helper-runner";
import { MeetingActivity } from "./meeting-activity";

export const operationLock = new OperationLock();
export const persistentControls = new PersistentControlClient();
export const meetingActivity = new MeetingActivity({
	now: () => Date.now(),
	schedule(callback, ms) {
		const timer = setTimeout(callback, ms);
		return () => clearTimeout(timer);
	},
});

/** Runs a Teams command that may open panels or end the meeting, so status reads around it do not count. */
async function tracked<T>(work: () => Promise<T>): Promise<T> {
	meetingActivity.commandStarted();
	try { return await work(); }
	finally { meetingActivity.commandFinished(); }
}

export const commandCoordinator = new CommandCoordinator(operationLock, async command => {
	if (command === "status") return persistentControls.execute(command);
	return tracked(async () => {
		if (isPersistentCommand(command)) return persistentControls.execute(command);
		persistentControls.pause();
		try { return await runTeamsCommand(command); }
		finally { persistentControls.resume(); }
	});
});
export const reactionCoordinator = new ReactionCoordinator(operationLock, reaction => tracked(async () => {
	persistentControls.pause();
	try { return await runReactionHelper(reaction); }
	finally { persistentControls.resume(); }
}));
