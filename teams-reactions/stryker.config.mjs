/** Mutation testing for the modules the unit tests load directly. */
export default {
	testRunner: "command",
	// The architecture test reads files outside the sandbox, so it is excluded here.
	commandRunner: { command: "node --test tests/helper-runner.test.mjs tests/persistent-controls.test.mjs tests/hold-gate.test.mjs tests/manifest.test.mjs tests/push-to-talk-controller.test.mjs" },
	mutate: ["src/helper-runner.ts", "src/hold-gate.ts", "src/push-to-talk-controller.ts"],
	coverageAnalysis: "off",
	reporters: ["clear-text", "progress", "json"],
	jsonReporter: { fileName: "reports/mutation/mutation.json" },
	thresholds: { high: 80, low: 60, break: 50 },
	timeoutMS: 20000,
	concurrency: 2,
};
