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

test("every key image has a dimmed twin for when no meeting is active", async () => {
	const pluginDir = new URL("../com.laurens-bolle.teams-reactions.sdPlugin/", import.meta.url);
	const images = manifest.Actions.flatMap(a => a.States.map(state => state.Image));
	assert.ok(images.length >= 16);
	for (const image of images) {
		for (const suffix of [".png", "@2x.png"]) {
			await fs.access(new URL(`${image}-inactive${suffix}`, pluginDir));
		}
	}
});

test("every resting image an action names is a manifest key image", async () => {
	const images = new Set(manifest.Actions.flatMap(a => a.States.map(state => state.Image)));
	const actionsDir = new URL("../src/actions/", import.meta.url);
	for (const name of await fs.readdir(actionsDir)) {
		const text = await fs.readFile(new URL(name, actionsDir), "utf8");
		for (const [, image] of text.matchAll(/restingImage(?: =|:) "([^"]+)"/g)) {
			assert.ok(images.has(image), `${name} names ${image}, which is not a key image`);
		}
	}
});
