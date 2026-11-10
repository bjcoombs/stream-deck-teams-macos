import { commandCoordinator } from "../teams-services";
import { stateSynchronizer } from "./state-synchronizer";

/**
 * Teams asks "Are you sure you want to leave?" only when you leave while sharing,
 * so a Leave tap runs leave-stay only while the last status showed sharing.
 */
export async function stayInLeaveDialog(): Promise<"stayed" | "none" | "busy"> {
	if (stateSynchronizer.latest?.screenShare !== "on") return "none";
	const execution = await commandCoordinator.execute("leave-stay");
	if (execution.status === "busy") return "busy";
	await stateSynchronizer.apply(execution.result);
	return execution.result.changed ? "stayed" : "none";
}
