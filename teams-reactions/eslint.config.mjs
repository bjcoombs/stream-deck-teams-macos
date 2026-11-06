import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["node_modules/", ".build-ts/", "release/", "reports/", ".stryker-tmp/", "*.sdPlugin/bin/"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		rules: {
			// Ceilings sit just above today's worst case so they ratchet, not chase.
			complexity: ["error", 15],
			"max-depth": ["error", 4],
			"max-lines": ["error", { max: 750, skipBlankLines: true, skipComments: true }],
			"max-lines-per-function": ["error", { max: 90, skipBlankLines: true, skipComments: true }],
			"max-params": ["error", 5],
		},
	},
	{
		// Baseline for existing protocol code: PersistentControlClient.receive is at
		// complexity 23 and depth 5. These ceilings may only move down.
		files: ["src/helper-runner.ts"],
		rules: { complexity: ["error", 23], "max-depth": ["error", 5] },
	},
	{
		files: ["tests/**/*.mjs", "*.mjs"],
		languageOptions: { globals: { process: "readonly", console: "readonly", setTimeout: "readonly", clearTimeout: "readonly", Buffer: "readonly", URL: "readonly", queueMicrotask: "readonly", setImmediate: "readonly" } },
		rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
	},
);
