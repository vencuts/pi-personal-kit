import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Matrix — renders built-in tool results like the 1999 film.
 *
 * Every new result decodes from falling half-width katakana into phosphor-green
 * text with a bright leading edge. Streaming output keeps a small digital-rain
 * tail while the transmission is arriving. Errors decode in red.
 *
 * Execution is delegated untouched to Pi's built-in tools; only rendering
 * changes. `/matrix` toggles the effect and restores Pi's stock renderers.
 *
 * This is a dependency-free local reimplementation of the behavior Ju Liu
 * demonstrated in a Pi community channel on 2026-09-02. The original local source was not
 * published. The safe built-in wrapping pattern is adapted from pi-quiet-tools
 * (MIT), commit a0fbdffabbbcdaa610d77b80ade305f0b6f9ab6a.
 */

const FRAME_MS = 84;
const DECODE_MS = 760;
const START_REVEAL = 0.12;
const STREAM_REVEAL = 0.7;
const MAX_ANIMATED_LINES = 48;
const MAX_ANIMATED_GLYPHS = 8_000;
const MAX_LIVE_TOOL_IDS = 128;
const RESET_FOREGROUND = "\x1b[39m";
const DARK_BACKGROUND = "\x1b[48;2;3;10;7m";
const RESET_BACKGROUND = "\x1b[49m";
const NOISE = Array.from("ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789");

interface Palette {
	decoded: string;
	edge: string;
	rain: string;
}

const GREEN: Palette = {
	decoded: "\x1b[38;2;0;220;72m",
	edge: "\x1b[38;2;205;255;218m",
	rain: "\x1b[38;2;0;92;34m",
};

const RED: Palette = {
	decoded: "\x1b[38;2;255;78;78m",
	edge: "\x1b[38;2;255;214;214m",
	rain: "\x1b[38;2;112;24;24m",
};

type AnyToolDefinition = ToolDefinition<any, any, any>;

interface BuiltInToolOptions {
	read: { autoResizeImages: boolean };
	bash: { commandPrefix: string | undefined; shellPath: string | undefined };
}

interface MatrixRowState {
	matrixOriginalCall?: Component;
	matrixOriginalResult?: Component;
	matrixCall?: MatrixComponent;
	matrixResult?: MatrixComponent;
}

interface MatrixRenderInput {
	lines: string[];
	progress: number;
	tick: number;
	seed: number;
	isError: boolean;
	maxAnimatedLines?: number;
	maxAnimatedGlyphs?: number;
}

function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (const character of text) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function noiseGlyph(seed: number, index: number, tick: number): string {
	let value = seed ^ Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(tick + 1, 0x27d4eb2d);
	value ^= value >>> 16;
	value = Math.imul(value, 0x7feb352d);
	value ^= value >>> 15;
	return NOISE[(value >>> 0) % NOISE.length]!;
}

function glyphWidth(character: string): number {
	return visibleWidth(character);
}

function isEligible(character: string): boolean {
	return !/\s/u.test(character) && glyphWidth(character) === 1;
}

function colorizeLine(line: string, color: string): string {
	return line.length === 0 ? "" : `${color}${line}${RESET_FOREGROUND}`;
}

/** Pure renderer used by the component and deterministic tests. */
export function renderMatrixLines(input: MatrixRenderInput): string[] {
	const palette = input.isError ? RED : GREEN;
	const maxLines = input.maxAnimatedLines ?? MAX_ANIMATED_LINES;
	const maxGlyphs = input.maxAnimatedGlyphs ?? MAX_ANIMATED_GLYPHS;
	const progress = Math.max(0, Math.min(1, input.progress));
	const eligiblePerLine = input.lines.map((line, lineIndex) =>
		lineIndex < maxLines ? Array.from(line).filter(isEligible).length : 0,
	);
	const totalEligible = Math.min(
		maxGlyphs,
		eligiblePerLine.reduce((sum, count) => sum + count, 0),
	);

	if (progress >= 1 || totalEligible === 0) {
		return input.lines.map((line) => colorizeLine(line, palette.decoded));
	}

	const decodedCutoff = Math.floor(totalEligible * progress);
	const edgeWidth = Math.max(2, Math.min(16, Math.ceil(totalEligible * 0.025)));
	let eligibleIndex = 0;

	return input.lines.map((line, lineIndex) => {
		if (lineIndex >= maxLines || eligibleIndex >= maxGlyphs) {
			return colorizeLine(line, palette.decoded);
		}

		let output = "";
		let activeColor = "";
		for (const character of Array.from(line)) {
			if (!isEligible(character) || eligibleIndex >= maxGlyphs) {
				output += character;
				continue;
			}

			let color: string;
			let displayed: string;
			if (eligibleIndex < decodedCutoff) {
				color = palette.decoded;
				displayed = character;
			} else if (eligibleIndex < decodedCutoff + edgeWidth) {
				color = palette.edge;
				displayed = character;
			} else {
				color = palette.rain;
				displayed = noiseGlyph(input.seed, eligibleIndex, input.tick);
			}

			if (color !== activeColor) {
				output += color;
				activeColor = color;
			}
			output += displayed;
			eligibleIndex += 1;
		}
		return output.length === 0 ? "" : `${output}${RESET_FOREGROUND}`;
	});
}

class MatrixAnimator {
	private components = new Set<MatrixComponent>();
	private timer: ReturnType<typeof setInterval> | undefined;

	add(component: MatrixComponent): void {
		this.components.add(component);
		if (this.timer) return;
		this.timer = setInterval(() => this.frame(), FRAME_MS);
		this.timer.unref?.();
	}

	remove(component: MatrixComponent): void {
		this.components.delete(component);
		if (this.components.size === 0) this.stopTimer();
	}

	stop(): void {
		for (const component of this.components) component.stopAnimation();
		this.components.clear();
		this.stopTimer();
	}

	private frame(): void {
		for (const component of [...this.components]) {
			if (!component.advanceFrame()) this.components.delete(component);
		}
		if (this.components.size === 0) this.stopTimer();
	}

	private stopTimer(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}
}

class MatrixComponent implements Component {
	private inner: Component;
	private signature: string;
	private isError: boolean;
	private isPartial: boolean;
	private animatable: boolean;
	private startedAt = Date.now();
	private tick = 0;
	private invalidateRow: () => void;
	private enabled: () => boolean;
	private animator: MatrixAnimator;
	private seed: number;

	constructor(options: {
		inner: Component;
		signature: string;
		toolCallId: string;
		isError: boolean;
		isPartial: boolean;
		animatable: boolean;
		invalidateRow: () => void;
		enabled: () => boolean;
		animator: MatrixAnimator;
	}) {
		this.inner = options.inner;
		this.signature = options.signature;
		this.isError = options.isError;
		this.isPartial = options.isPartial;
		this.animatable = options.animatable;
		this.invalidateRow = options.invalidateRow;
		this.enabled = options.enabled;
		this.animator = options.animator;
		this.seed = fnv1a(`${options.toolCallId}:${options.signature}`);
		this.syncAnimation();
	}

	update(options: {
		inner: Component;
		signature: string;
		toolCallId: string;
		isError: boolean;
		isPartial: boolean;
		animatable: boolean;
		invalidateRow: () => void;
	}): void {
		const changed =
			this.signature !== options.signature ||
			this.isPartial !== options.isPartial ||
			this.isError !== options.isError;
		this.inner = options.inner;
		this.signature = options.signature;
		this.isError = options.isError;
		this.isPartial = options.isPartial;
		this.animatable = options.animatable;
		this.invalidateRow = options.invalidateRow;
		if (changed) {
			this.startedAt = Date.now();
			this.tick = 0;
			this.seed = fnv1a(`${options.toolCallId}:${options.signature}`);
		}
		this.syncAnimation();
	}

	stopAnimation(): void {
		this.animatable = false;
	}

	advanceFrame(): boolean {
		if (!this.enabled() || !this.shouldAnimate()) return false;
		this.tick += 1;
		this.invalidateRow();
		return this.shouldAnimate();
	}

	invalidate(): void {
		this.inner.invalidate?.();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(0, width);
		const plainLines = this.inner
			.render(safeWidth)
			.map((line) => truncateToWidth(stripTerminalSequences(line), safeWidth, ""));
		return renderMatrixLines({
			lines: plainLines,
			progress: this.progress(),
			tick: this.tick,
			seed: this.seed,
			isError: this.isError,
		}).map((line) => {
			const padded = truncateToWidth(line, safeWidth, "", true);
			return `${DARK_BACKGROUND}${padded}${RESET_BACKGROUND}`;
		});
	}

	private syncAnimation(): void {
		if (this.enabled() && this.shouldAnimate()) this.animator.add(this);
		else this.animator.remove(this);
	}

	private shouldAnimate(): boolean {
		return this.animatable && (this.isPartial || Date.now() - this.startedAt < DECODE_MS);
	}

	private progress(): number {
		if (!this.enabled() || !this.animatable) return 1;
		if (this.isPartial) return STREAM_REVEAL;
		const elapsed = Math.max(0, Date.now() - this.startedAt);
		const linear = Math.min(1, elapsed / DECODE_MS);
		const eased = 1 - (1 - linear) * (1 - linear);
		return START_REVEAL + (1 - START_REVEAL) * eased;
	}
}

function resultSignature(result: { content: Array<{ type: string; text?: string }> }, isPartial: boolean, expanded: boolean): string {
	let value = `${isPartial ? "partial" : "final"}:${expanded ? "expanded" : "collapsed"}`;
	for (const item of result.content) {
		value += `\u0000${item.type}:${item.text ?? ""}`;
	}
	return fnv1a(value).toString(16);
}

function callSignature(args: unknown): string {
	try {
		return fnv1a(JSON.stringify(args)).toString(16);
	} catch {
		return "unserializable";
	}
}

function wrapWithMatrix(options: {
	definition: AnyToolDefinition;
	enabled: () => boolean;
	animator: MatrixAnimator;
	isAnimatable: (toolCallId: string) => boolean;
}): AnyToolDefinition {
	const { definition, enabled, animator, isAnimatable } = options;
	const renderCall = definition.renderCall;
	const renderResult = definition.renderResult;
	if (!renderCall || !renderResult) return definition;

	return {
		...definition,
		renderCall(args, theme, context) {
			const state = context.state as MatrixRowState;
			const inner = renderCall(args, theme, {
				...context,
				lastComponent: state.matrixOriginalCall,
			});
			state.matrixOriginalCall = inner;
			if (!enabled()) {
				state.matrixCall?.stopAnimation();
				return inner;
			}

			const update = {
				inner,
				signature: callSignature(args),
				toolCallId: context.toolCallId,
				isError: context.isError,
				isPartial: false,
				animatable: false,
				invalidateRow: context.invalidate,
			};
			if (state.matrixCall) state.matrixCall.update(update);
			else {
				state.matrixCall = new MatrixComponent({
					...update,
					enabled,
					animator,
				});
			}
			return state.matrixCall;
		},
		renderResult(result, renderOptions, theme, context) {
			const state = context.state as MatrixRowState;
			// Pi's renderer owns tool-specific timers and truncation, so always run it.
			const inner = renderResult(result, renderOptions, theme, {
				...context,
				lastComponent: state.matrixOriginalResult,
			});
			state.matrixOriginalResult = inner;
			if (!enabled()) {
				state.matrixResult?.stopAnimation();
				return inner;
			}

			const update = {
				inner,
				signature: resultSignature(result, renderOptions.isPartial, renderOptions.expanded),
				toolCallId: context.toolCallId,
				isError: context.isError,
				isPartial: renderOptions.isPartial,
				animatable: isAnimatable(context.toolCallId),
				invalidateRow: context.invalidate,
			};
			if (state.matrixResult) state.matrixResult.update(update);
			else {
				state.matrixResult = new MatrixComponent({
					...update,
					enabled,
					animator,
				});
			}
			return state.matrixResult;
		},
	};
}

function readJsonObject(path: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function expandHome(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value === "~") return homedir();
	return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function readToolOptions(cwd: string): BuiltInToolOptions {
	const globalSettings = readJsonObject(join(homedir(), ".pi", "agent", "settings.json"));
	const projectSettings = readJsonObject(join(cwd, ".pi", "settings.json"));
	const merged = { ...globalSettings, ...projectSettings };
	const globalImages = globalSettings.images;
	const projectImages = projectSettings.images;
	const globalAutoResize =
		globalImages && typeof globalImages === "object"
			? (globalImages as { autoResize?: unknown }).autoResize
			: undefined;
	const projectAutoResize =
		projectImages && typeof projectImages === "object"
			? (projectImages as { autoResize?: unknown }).autoResize
			: undefined;
	const autoResize =
		typeof projectAutoResize === "boolean" ? projectAutoResize : globalAutoResize;
	return {
		read: { autoResizeImages: typeof autoResize === "boolean" ? autoResize : true },
		bash: {
			commandPrefix: asString(merged.shellCommandPrefix),
			shellPath: expandHome(asString(merged.shellPath)),
		},
	};
}

function builtInDefinitions(cwd: string, options: BuiltInToolOptions): AnyToolDefinition[] {
	return [
		createReadToolDefinition(cwd, options.read),
		createBashToolDefinition(cwd, options.bash),
		createEditToolDefinition(cwd),
		createWriteToolDefinition(cwd),
		createGrepToolDefinition(cwd),
		createFindToolDefinition(cwd),
		createLsToolDefinition(cwd),
	];
}

function redrawRows(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui") return;
	const expanded = ctx.ui.getToolsExpanded();
	ctx.ui.setToolsExpanded(!expanded);
	ctx.ui.setToolsExpanded(expanded);
}

export default function matrixExtension(pi: ExtensionAPI): void {
	let enabled = true;
	let installed = false;
	const animator = new MatrixAnimator();
	const liveToolIds = new Set<string>();
	const liveToolOrder: string[] = [];

	const rememberLiveTool = (toolCallId: string) => {
		if (liveToolIds.has(toolCallId)) return;
		liveToolIds.add(toolCallId);
		liveToolOrder.push(toolCallId);
		while (liveToolOrder.length > MAX_LIVE_TOOL_IDS) {
			const oldest = liveToolOrder.shift();
			if (oldest) liveToolIds.delete(oldest);
		}
	};

	pi.on("tool_execution_start", (event) => rememberLiveTool(event.toolCallId));

	pi.on("session_start", (_event, ctx) => {
		if (installed) return;
		installed = true;
		const owners = new Map(pi.getAllTools().map((tool) => [tool.name, tool.sourceInfo.source]));
		const skipped: string[] = [];
		for (const definition of builtInDefinitions(ctx.cwd, readToolOptions(ctx.cwd))) {
			if (owners.get(definition.name) !== "builtin") {
				if (owners.has(definition.name)) skipped.push(definition.name);
				continue;
			}
			pi.registerTool(
				wrapWithMatrix({
					definition,
					enabled: () => enabled,
					animator,
					isAnimatable: (toolCallId) => liveToolIds.has(toolCallId),
				}),
			);
		}
		if (skipped.length > 0 && ctx.hasUI) {
			ctx.ui.notify(
				`matrix: another extension owns ${skipped.join(", ")}; those tools keep their current renderer`,
				"warning",
			);
		}
	});

	pi.on("session_shutdown", () => animator.stop());

	const setEnabled = (ctx: ExtensionContext, next: boolean) => {
		enabled = next;
		if (!enabled) animator.stop();
		redrawRows(ctx);
		if (ctx.hasUI) ctx.ui.notify(`Matrix renderer: ${enabled ? "on" : "off"}`, "info");
	};

	pi.registerCommand("matrix", {
		description: "Toggle the Matrix tool-result renderer: /matrix [on|off|status]",
		handler: async (args, ctx) => {
			const argument = (args ?? "").trim().toLowerCase();
			if (argument === "status") {
				ctx.ui.notify(`Matrix renderer: ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (argument === "" || argument === "toggle") {
				setEnabled(ctx, !enabled);
				return;
			}
			if (argument === "on") {
				setEnabled(ctx, true);
				return;
			}
			if (argument === "off") {
				setEnabled(ctx, false);
				return;
			}
			ctx.ui.notify('Usage: /matrix [on|off|status]', "warning");
		},
	});
}

export const __test = {
	fnv1a,
	noiseGlyph,
	resultSignature,
	callSignature,
	wrapWithMatrix,
	MatrixAnimator,
	MatrixComponent,
	GREEN,
	RED,
	DARK_BACKGROUND,
	RESET_BACKGROUND,
};
