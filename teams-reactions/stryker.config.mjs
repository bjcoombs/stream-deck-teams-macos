/** Mutation testing for the modules the unit tests load directly. */
export default {
	testRunner: "command",
	commandRunner: { command: "node --test tests/*.test.mjs" },
	mutate: ["src/helper-runner.ts", "src/hold-gate.ts"],
	coverageAnalysis: "off",
	reporters: ["clear-text", "progress", "json"],
	jsonReporter: { fileName: "reports/mutation/mutation.json" },
	thresholds: { high: 80, low: 60, break: 50 },
	timeoutMS: 20000,
	concurrency: 2,
};
