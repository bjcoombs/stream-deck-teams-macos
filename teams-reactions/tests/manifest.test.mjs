import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await fs.readFile(new URL("../com.laurens-bolle.teams-reactions.sdPlugin/manifest.json", import.meta.url), "utf8"));

test("the shipped manifest does not enable the Node.js inspector", () => {
	// "enabled" or "break" makes Stream Deck start the plugin with --inspect in
	// developer mode, which lets any local process attach and run code in it.
	assert.equal(manifest.Nodejs?.Debug, undefined);
});

const PREFIX = "com.laurens-bolle.teams-reactions.";
const actionFor = suffix => manifest.Actions.find(a => a.UUID === PREFIX + suffix);

test("the Reaction picker is listed with its Property Inspector", async () => {
	const picker = actionFor("reaction");
	assert.equal(picker?.Name, "Reaction");
	assert.notEqual(picker.VisibleInActionsList, false);
	const page = await fs.readFile(new URL(`../com.laurens-bolle.teams-reactions.sdPlugin/${picker.PropertyInspectorPath}`, import.meta.url), "utf8");
	for (const reaction of ["like", "love", "applause", "laugh", "surprise"]) {
		assert.match(page, new RegExp(`value="${reaction}"`), `the picker offers ${reaction}`);
	}
	assert.equal([...page.matchAll(/type="radio"/g)].length, 5, "the picker offers only the reactions Teams supports");
});

test("the fixed reaction actions stay installed but hidden from the action list", () => {
	for (const reaction of ["like", "love", "applause", "laugh", "surprise"]) {
		assert.equal(actionFor(reaction)?.VisibleInActionsList, false, `${reaction} stays registered and hidden`);
	}
});
