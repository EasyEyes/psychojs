/**
 * Unit tests for the EasyEyes color pipeline (util/ColorPipeline.js) —
 * config validation, feature detection/failure reporting, readback format
 * handling, and CSS body-color tagging. GPU-dependent paths (PIXI filters,
 * background quad) require a browser and are covered by the manual test
 * page docs/hdr/p_canvascolor.html instead.
 */

import {
	applyColorPipelineToRenderer,
	configureColorPipeline,
	cssBodyColor,
	currentFilterResolution,
	drawingBufferIsFloat,
	getColorPipelineConfig,
	getColorPipelineReport,
	readDrawingBufferPixel,
	readDrawingBufferRect,
	resumeDither,
	setDitherLsb,
	suspendDither,
} from "./ColorPipeline.js";

// Minimal fakes. getExtension returns null so the float render-texture path
// (which constructs PIXI objects needing a DOM) stays off in node.
const makeFakeGl = (overrides = {}) => ({
	getExtension: () => null,
	getError: () => 0,
	canvas: { width: 200, height: 100 },
	readPixels: () => {},
	NO_ERROR: 0,
	INVALID_ENUM: 0x0500,
	RGBA: 0x1908,
	RGBA16F: 0x881a,
	UNSIGNED_BYTE: 0x1401,
	FLOAT: 0x1406,
	...overrides,
});

/**
 * A gl whose drawingBufferStorage succeeds or fails the way a real one does:
 * by setting the GL error queue and leaving drawingBufferFormat alone, NOT by
 * throwing.
 */
const makeFloat16Gl = ({ succeed }) => {
	const gl = makeFakeGl({
		drawingBufferFormat: 0x8058, // RGBA8
		getExtension: (name) => (name === "EXT_color_buffer_float" ? {} : null),
	});
	let pendingError = 0;
	gl.getError = () => {
		const e = pendingError;
		pendingError = 0;
		return e;
	};
	gl.drawingBufferStorage = (format) => {
		if (succeed) gl.drawingBufferFormat = format;
		else pendingError = gl.INVALID_ENUM;
	};
	return gl;
};

const makeFakeRenderer = (gl, { resolution } = {}) => ({
	gl,
	resolution,
	filter: { texturePool: { textureOptions: {} } },
	screen: { width: 200, height: 100 },
	_backgroundColorRgba: [0, 0, 0, 1],
});

const makeFakeRootContainer = () => ({
	addChildAt: jest.fn(),
	filters: null,
	filterArea: null,
});

const resetConfig = () =>
	configureColorPipeline({
		colorSpace: "srgb",
		float16Bool: false,
		ditherBool: false,
		ditherLsb: 1 / 255,
	});

describe("configureColorPipeline", () => {
	beforeEach(resetConfig);

	test("accepts valid values", () => {
		configureColorPipeline({
			colorSpace: "display-p3",
			float16Bool: true,
			ditherBool: true,
			ditherLsb: 1 / 1023,
		});
		expect(getColorPipelineConfig()).toEqual({
			colorSpace: "display-p3",
			float16Bool: true,
			ditherBool: true,
			ditherLsb: 1 / 1023,
		});
	});

	test("rejects invalid values, keeping previous config", () => {
		configureColorPipeline({
			colorSpace: "adobe-rgb",
			float16Bool: "yes",
			ditherBool: 1,
			ditherLsb: 2,
		});
		expect(getColorPipelineConfig()).toEqual({
			colorSpace: "srgb",
			float16Bool: false,
			ditherBool: false,
			ditherLsb: 1 / 255,
		});
	});
});

describe("applyColorPipelineToRenderer", () => {
	beforeEach(resetConfig);

	test("default config is inert (legacy behavior untouched)", () => {
		const gl = makeFakeGl({ drawingBufferColorSpace: "srgb" });
		const renderer = makeFakeRenderer(gl);
		const root = makeFakeRootContainer();
		applyColorPipelineToRenderer(renderer, root);

		expect(getColorPipelineReport().applied).toBe(false);
		expect(gl.drawingBufferColorSpace).toBe("srgb");
		expect(root.addChildAt).not.toHaveBeenCalled();
		expect(root.filters).toBeNull();
		expect(renderer.filter.texturePool.textureOptions).toEqual({});
	});

	test("tags the drawing buffer display-p3 when supported", () => {
		configureColorPipeline({ colorSpace: "display-p3" });
		const gl = makeFakeGl({ drawingBufferColorSpace: "srgb" });
		const renderer = makeFakeRenderer(gl);
		applyColorPipelineToRenderer(renderer, makeFakeRootContainer());

		expect(gl.drawingBufferColorSpace).toBe("display-p3");
		const report = getColorPipelineReport();
		expect(report.applied).toBe(true);
		expect(report.colorSpace).toBe("display-p3");
		expect(report.failures).toEqual([]);
	});

	test("records failure when drawingBufferColorSpace is unsupported", () => {
		configureColorPipeline({ colorSpace: "display-p3" });
		const gl = makeFakeGl(); // property absent
		applyColorPipelineToRenderer(
			makeFakeRenderer(gl),
			makeFakeRootContainer(),
		);

		const report = getColorPipelineReport();
		expect(report.colorSpace).toBe("srgb");
		expect(report.failures).toContain("drawingBufferColorSpace unsupported");
	});

	test("records failure when float16 backbuffer is unsupported", () => {
		configureColorPipeline({ float16Bool: true });
		const gl = makeFakeGl(); // no drawingBufferStorage
		applyColorPipelineToRenderer(
			makeFakeRenderer(gl),
			makeFakeRootContainer(),
		);

		const report = getColorPipelineReport();
		expect(report.float16Backbuffer).toBe(false);
		expect(report.failures).toContain("drawingBufferStorage unsupported");
	});

	// drawingBufferStorage signals failure through the GL error queue rather
	// than by throwing, so without a getError check the report would read
	// "float16Backbuffer: false, failures: []" — indistinguishable from "not
	// requested", which is exactly the silent fallback tests must not accept.
	test("float16 rejected via the GL error queue is reported, not silent", () => {
		configureColorPipeline({ float16Bool: true });
		const gl = makeFloat16Gl({ succeed: false });
		applyColorPipelineToRenderer(
			makeFakeRenderer(gl),
			makeFakeRootContainer(),
		);

		const report = getColorPipelineReport();
		expect(report.float16Backbuffer).toBe(false);
		expect(drawingBufferIsFloat()).toBe(false);
		expect(
			report.failures.some((f) => f.includes("drawingBufferStorage")),
		).toBe(true);
	});

	test("enables EXT_color_buffer_float before requesting RGBA16F", () => {
		configureColorPipeline({ float16Bool: true });
		const order = [];
		// succeed:false keeps the float color path (and its DOM-dependent
		// background quad) out of this node-environment test; the ordering
		// under test happens before either way.
		const gl = makeFloat16Gl({ succeed: false });
		const realGetExtension = gl.getExtension;
		gl.getExtension = (name) => {
			order.push(`getExtension:${name}`);
			return realGetExtension(name);
		};
		const realStorage = gl.drawingBufferStorage;
		gl.drawingBufferStorage = (format) => {
			order.push("drawingBufferStorage");
			realStorage(format);
		};
		applyColorPipelineToRenderer(
			makeFakeRenderer(gl),
			makeFakeRootContainer(),
		);

		// The WebGL spec requires the extension to be enabled first, or
		// drawingBufferStorage(RGBA16F) generates INVALID_ENUM.
		expect(order.indexOf("getExtension:EXT_color_buffer_float")).toBeLessThan(
			order.indexOf("drawingBufferStorage"),
		);
	});

	test("dither without float render textures is disabled with a report", () => {
		configureColorPipeline({ ditherBool: true });
		const gl = makeFakeGl(); // getExtension → null
		const root = makeFakeRootContainer();
		applyColorPipelineToRenderer(makeFakeRenderer(gl), root);

		const report = getColorPipelineReport();
		expect(report.dither).toBe(false);
		expect(report.floatColorPath).toBe(false);
		expect(root.filters).toBeNull();
		expect(
			report.failures.some((f) => f.includes("float16 render textures")),
		).toBe(true);
	});
});

// Runtime dither control, used by the visual display-precision test
// (threshold components/displayPrecisionTest.js): the test suspends the
// dither pass while it measures the display's own quantization, then sets
// the dither LSB to the measured effective precision and resumes. The
// ACTIVE paths (a real dither filter attached to a root container) need
// PIXI objects that require a DOM, so they are exercised by
// tests/e2e/displayPrecisionTest.e2e.test.ts; here we pin the config
// plumbing and the guarantees that matter when dither never activated.
describe("dither runtime control", () => {
	beforeEach(resetConfig);

	test("setDitherLsb updates the sticky config and the report", () => {
		expect(setDitherLsb(1 / 1023)).toBe(true);
		expect(getColorPipelineConfig().ditherLsb).toBeCloseTo(1 / 1023, 12);
		expect(getColorPipelineReport().ditherLsb).toBeCloseTo(1 / 1023, 12);
	});

	test("setDitherLsb rejects out-of-range and non-numeric values", () => {
		const before = getColorPipelineConfig().ditherLsb;
		expect(setDitherLsb(0)).toBe(false);
		expect(setDitherLsb(1)).toBe(false);
		expect(setDitherLsb(-0.1)).toBe(false);
		expect(setDitherLsb("1/255")).toBe(false);
		expect(setDitherLsb(NaN)).toBe(false);
		expect(getColorPipelineConfig().ditherLsb).toBe(before);
	});

	test("suspendDither reports false when dither never activated", () => {
		configureColorPipeline({ ditherBool: true });
		// getExtension → null: no float render textures, dither declined.
		applyColorPipelineToRenderer(
			makeFakeRenderer(makeFakeGl()),
			makeFakeRootContainer(),
		);
		expect(getColorPipelineReport().dither).toBe(false);
		expect(suspendDither()).toBe(false);
	});

	test("resumeDither cannot switch dither on where apply declined it", () => {
		configureColorPipeline({ ditherBool: true });
		const root = makeFakeRootContainer();
		applyColorPipelineToRenderer(makeFakeRenderer(makeFakeGl()), root);

		expect(resumeDither()).toBe(false);
		expect(getColorPipelineReport().dither).toBe(false);
		expect(root.filters).toBeNull();
	});
});

// Regression: PIXI v6 Filters default to settings.FILTER_RESOLUTION (= 1)
// while the EasyEyes renderer runs at devicePixelRatio (or a
// setResolution-derived value). Pipeline filters built at resolution 1
// render through a CSS-pixel-density intermediate texture and get
// upscaled: blurry text/background, and dither noise in chunky
// low-res-texel blocks. currentFilterResolution() is the single source the
// filter factories read; it must track the renderer, per-filter, without
// touching the global PIXI setting.
describe("currentFilterResolution", () => {
	beforeEach(resetConfig);

	test("tracks the renderer's resolution (e.g. devicePixelRatio 2)", () => {
		configureColorPipeline({ colorSpace: "display-p3" });
		applyColorPipelineToRenderer(
			makeFakeRenderer(makeFakeGl({ drawingBufferColorSpace: "srgb" }), {
				resolution: 2,
			}),
			makeFakeRootContainer(),
		);
		expect(currentFilterResolution()).toBe(2);
	});

	test("passes fractional setResolution-derived values through", () => {
		configureColorPipeline({ colorSpace: "display-p3" });
		applyColorPipelineToRenderer(
			makeFakeRenderer(makeFakeGl({ drawingBufferColorSpace: "srgb" }), {
				resolution: 1.37,
			}),
			makeFakeRootContainer(),
		);
		expect(currentFilterResolution()).toBe(1.37);
	});

	test("falls back to 1 without a renderer resolution", () => {
		configureColorPipeline({ colorSpace: "display-p3" });
		applyColorPipelineToRenderer(
			makeFakeRenderer(makeFakeGl({ drawingBufferColorSpace: "srgb" })),
			makeFakeRootContainer(),
		);
		expect(currentFilterResolution()).toBe(1);
	});
});

describe("readDrawingBufferPixel", () => {
	beforeEach(resetConfig);

	test("8-bit path normalizes bytes to [0,1]", () => {
		const gl = makeFakeGl({
			readPixels: (x, y, w, h, format, type, out) => {
				out.set([128, 0, 255, 255]);
			},
		});
		// default config → apply leaves the byte path in place
		applyColorPipelineToRenderer(
			makeFakeRenderer(gl),
			makeFakeRootContainer(),
		);
		const px = readDrawingBufferPixel(gl, 0, 0);
		expect(px[0]).toBeCloseTo(128 / 255);
		expect(px[1]).toBe(0);
		expect(px[2]).toBe(1);
		expect(px[3]).toBe(1);
	});
});

describe("readDrawingBufferRect", () => {
	beforeEach(resetConfig);

	test("8-bit path reads bytes and normalizes to [0,1]", () => {
		const gl = makeFakeGl({
			readPixels: (x, y, w, h, format, type, out) => {
				expect(type).toBe(0x1401); // UNSIGNED_BYTE
				out.set([0, 64, 128, 255, 255, 128, 64, 0]);
			},
		});
		applyColorPipelineToRenderer(
			makeFakeRenderer(gl),
			makeFakeRootContainer(),
		);

		const px = readDrawingBufferRect(gl, 0, 0, 2, 1);
		expect(px).toBeInstanceOf(Float32Array);
		expect(px).toHaveLength(8);
		expect(px[1]).toBeCloseTo(64 / 255);
		expect(px[4]).toBe(1);
	});

	// The FLOAT readback path needs an actually-float drawing buffer, which
	// implies the DOM-dependent float color path; it is covered end-to-end by
	// tests/e2e/color-pipeline.e2e.test.ts.
});

describe("cssBodyColor", () => {
	beforeEach(resetConfig);

	const fakeColor = { hex: "#808080", rgb: [0.5, 0.25, 0.125] };

	test("legacy hex when the pipeline is off", () => {
		applyColorPipelineToRenderer(
			makeFakeRenderer(makeFakeGl()),
			makeFakeRootContainer(),
		);
		expect(cssBodyColor(fakeColor)).toBe("#808080");
	});

	test("display-p3 tagged string when the p3 pipeline is active", () => {
		configureColorPipeline({ colorSpace: "display-p3" });
		applyColorPipelineToRenderer(
			makeFakeRenderer(makeFakeGl({ drawingBufferColorSpace: "srgb" })),
			makeFakeRootContainer(),
		);
		expect(cssBodyColor(fakeColor)).toBe(
			"color(display-p3 0.500000 0.250000 0.125000)",
		);
	});
});
