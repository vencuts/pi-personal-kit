import assert from "node:assert/strict";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { __test, renderMatrixLines } from "./index.ts";

function plain(lines: string[]): string[] {
	return lines.map(stripTerminalSequences);
}

const original = ["read /tmp/example.ts", "wide: 🐝 café", "", "status = ok"];
const decoded = renderMatrixLines({
	lines: original,
	progress: 1,
	tick: 0,
	seed: 42,
	isError: false,
});
assert.deepEqual(plain(decoded), original, "progress=1 must reproduce the original text exactly");
assert.ok(decoded[0]!.includes(__test.GREEN.decoded), "successful output must use phosphor green");

const rain0 = renderMatrixLines({
	lines: original,
	progress: 0,
	tick: 0,
	seed: 42,
	isError: false,
});
const rain1 = renderMatrixLines({
	lines: original,
	progress: 0,
	tick: 1,
	seed: 42,
	isError: false,
});
assert.notDeepEqual(plain(rain0), original, "progress=0 must obscure eligible glyphs");
assert.notDeepEqual(plain(rain0), plain(rain1), "rain glyphs must move between frames");
assert.ok(plain(rain0)[1]!.includes("🐝"), "wide glyphs must stay intact");
for (let index = 0; index < original.length; index += 1) {
	assert.equal(
		visibleWidth(rain0[index]!),
		visibleWidth(original[index]!),
		`matrix rendering must preserve display width on line ${index + 1}`,
	);
}

const failed = renderMatrixLines({
	lines: ["Error: permission denied"],
	progress: 0.5,
	tick: 3,
	seed: 7,
	isError: true,
});
assert.ok(failed[0]!.includes(__test.RED.decoded), "errors must decode in red");
assert.ok(failed[0]!.includes(__test.RED.rain), "error noise must stay in the red palette");

const capped = renderMatrixLines({
	lines: ["first line", "second line"],
	progress: 0,
	tick: 0,
	seed: 1,
	isError: false,
	maxAnimatedLines: 1,
});
assert.notEqual(plain(capped)[0], "first line", "lines inside the cap must animate");
assert.equal(plain(capped)[1], "second line", "lines outside the cap must remain readable");

assert.equal(__test.fnv1a("matrix"), __test.fnv1a("matrix"), "hashing must be deterministic");
assert.notEqual(__test.noiseGlyph(1, 1, 1), __test.noiseGlyph(1, 1, 2), "tick must affect rain");
assert.equal(
	__test.resultSignature({ content: [{ type: "text", text: "ok" }] }, false, false),
	__test.resultSignature({ content: [{ type: "text", text: "ok" }] }, false, false),
	"result signatures must be stable",
);
assert.notEqual(
	__test.resultSignature({ content: [{ type: "text", text: "ok" }] }, true, false),
	__test.resultSignature({ content: [{ type: "text", text: "ok" }] }, false, false),
	"partial and final results need different signatures",
);

let enabled = false;
const animator = new __test.MatrixAnimator();
const callComponent = {
	invalidate() {},
	render() {
		return ["bash echo ok"];
	},
};
const resultComponent = {
	invalidate() {},
	render() {
		return ["ok"];
	},
};
const execute = async () => ({ content: [{ type: "text" as const, text: "ok" }], details: undefined });
const definition = {
	name: "bash",
	label: "bash",
	description: "test",
	parameters: {} as never,
	execute,
	renderCall() {
		return callComponent;
	},
	renderResult() {
		return resultComponent;
	},
};
const wrapped = __test.wrapWithMatrix({
	definition,
	enabled: () => enabled,
	animator,
	isAnimatable: () => false,
});
assert.equal(wrapped.execute, execute, "tool execution must pass through by identity");

const state: Record<string, unknown> = {};
const context = {
	args: {},
	toolCallId: "call-1",
	invalidate() {},
	lastComponent: undefined,
	state,
	cwd: "/tmp",
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: false,
	showImages: false,
	isError: false,
} as never;
const result = { content: [{ type: "text" as const, text: "ok" }], details: undefined };
const options = { expanded: false, isPartial: false };
const theme = {} as never;

const stock = wrapped.renderResult!(result, options, theme, context);
assert.equal(stock, resultComponent, "off mode must return Pi's stock component");
enabled = true;
const matrix = wrapped.renderResult!(result, options, theme, context);
assert.notEqual(matrix, resultComponent, "on mode must return the Matrix wrapper");
const darkRendered = matrix.render(80);
assert.equal(plain(darkRendered)[0]!.trimEnd(), "ok", "non-live rows must be readable immediately");
assert.ok(darkRendered[0]!.includes(__test.DARK_BACKGROUND), "Matrix rows must use the dark background");
assert.equal(visibleWidth(darkRendered[0]!), 80, "the dark background must fill the component width");
enabled = false;
const restored = wrapped.renderResult!(result, options, theme, context);
assert.equal(restored, resultComponent, "turning Matrix off must restore the stock component");
animator.stop();

console.log("matrix extension tests: passed");
