/**
 * ColorPipeline — EasyEyes screen color pipeline (Phase 1).
 *
 * Upgrades the canvas that PsychoJS's Window/PIXI v6 renderer draws into,
 * without upgrading PIXI:
 *
 *  1. COLOR MANAGEMENT + COLOR SPACE (sRGB / Display-P3).
 *     Browsers color-manage every *tagged* canvas: the drawing buffer is
 *     converted to the display's ICC profile by the compositor (relative
 *     colorimetric). The WebGL drawing buffer is tagged sRGB by default;
 *     `gl.drawingBufferColorSpace = "display-p3"` re-tags it (Chrome/Edge
 *     104+, Safari 16.4+, Firefox 132+). Numeric color values are then
 *     interpreted as Display-P3 coordinates. Achromatic (R=G=B) values are
 *     identical in both spaces (same primaries' white point, same transfer
 *     function), so gray-scale experiments are unaffected by the tag choice.
 *     NOTE: `gl.unpackColorSpace` is deliberately left at its default
 *     ("srgb" = no conversion of sRGB-tagged uploads), so numbers pass
 *     through texture uploads unchanged and ALL drawing paths (clear color,
 *     rasterized text, shapes) agree on one interpretation: parameter values
 *     are coordinates in the screen's color space.
 *
 *  2. FLOAT16 PRECISION.
 *     - `gl.drawingBufferStorage(gl.RGBA16F, w, h)` makes the backbuffer
 *       16-bit float (Chromium 122+ only; harmless no-op elsewhere).
 *     - PIXI's filter system renders through pooled intermediate textures
 *       that default to 8-bit; we re-type the pool to HALF_FLOAT (requires
 *       EXT_color_buffer_(half_)float, universal on desktop WebGL2).
 *     - 8-bit chokepoints for color values are bypassed:
 *       (a) text: TextStim rasterizes glyphs WHITE and a ColorizeFilter
 *           multiplies by a float32 uniform color (see syncTextColorFilter);
 *       (b) background: a full-screen white sprite with a ColorizeFilter
 *           carries the float background color (PIXI's backgroundColor is
 *           quantized to 8-bit int), and the raw clear color is also written
 *           as floats into renderer._backgroundColorRgba.
 *
 *  3. EFFECTIVE >8-BIT ON ANY DISPLAY: "noisy-bit" spatiotemporal dithering
 *     (Allard & Faubert, 2008, Behav Res Methods). Uniform noise of
 *     ±0.5 output-LSB is added per pixel per frame before the hardware
 *     quantizes; the temporal average over frames equals the requested
 *     value, adding ~2-3 effective bits at 60+ Hz. Applied as a final
 *     full-screen filter on the root container (whose input is float16 —
 *     see 2 — so precision survives up to the quantization point).
 *
 * The pipeline is inert unless configured (configureColorPipeline) before
 * the PsychoJS Window is created; with the default config every code path
 * preserves the legacy 8-bit behavior byte-for-byte.
 */

import * as PIXI from "pixi.js-legacy";

// ------------------------------- state ---------------------------------

const DEFAULT_CONFIG = Object.freeze({
	// "srgb" | "display-p3" — color space the drawing buffer is tagged with.
	colorSpace: "srgb",
	// Request a float16 (RGBA16F) backbuffer (Chromium 122+).
	float16Bool: false,
	// Noisy-bit spatiotemporal dithering of the final image.
	ditherBool: false,
	// LSB of the assumed output pipe, in [0,1] units. 1/255 targets 8-bit
	// panels; use 1/1023 on a known 10-bit end-to-end pipe.
	ditherLsb: 1 / 255,
	// ditherLsb: 1 / 1023,
});

const config = { ...DEFAULT_CONFIG };

// Per-renderer application state. Reset each time a renderer is (re)created
// (Window.changeResolution/changeScaleMode rebuild the renderer).
const state = {
	applied: false,
	renderer: null,
	colorSpaceApplied: "srgb",
	drawingBufferFloat: false,
	floatFilterTextures: false,
	floatColorActive: false,
	ditherActive: false,
	backgroundQuad: null,
	ditherFilter: null,
	frame: 0,
	failures: [],
};

// ------------------------------ filters --------------------------------

// Multiplies the (premultiplied) source by a float RGB uniform. Used to
// carry float-precision color for white-rasterized text and the white
// background quad. Output stays premultiplied (rgb scaled by coverage s.a),
// matching PIXI's NORMAL blend mode.
// NOTE: PIXI v6 only skips prepending its default (mediump) precision
// header when the source's FIRST characters are "precision", so both
// fragment sources below must start exactly that way (highp matters for
// the noise hash on mobile GPUs and for float color fidelity).
const COLORIZE_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec3 uColorRGB;

void main(void) {
	vec4 s = texture2D(uSampler, vTextureCoord);
	gl_FragColor = vec4(uColorRGB, 1.0) * s.a;
}
`;

// Noisy-bit dither: add per-channel uniform noise in [-0.5, +0.5] * LSB.
// The seed changes every frame so the temporal mean equals the input.
const DITHER_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uSeed;
uniform float uLsb;

float noise01(vec2 co, float ch) {
	return fract(sin(dot(co + vec2(ch, uSeed), vec2(12.9898, 78.233))) * 43758.5453);
}

void main(void) {
	vec4 c = texture2D(uSampler, vTextureCoord);
	vec3 n = vec3(
		noise01(gl_FragCoord.xy, 0.0),
		noise01(gl_FragCoord.xy, 17.0),
		noise01(gl_FragCoord.xy, 29.0)
	) - 0.5;
	gl_FragColor = vec4(c.rgb + uLsb * n, c.a);
}
`;

/**
 * Resolution for the pipeline's filters: always the renderer's resolution.
 *
 * PIXI v6 initializes every Filter from PIXI.settings.FILTER_RESOLUTION,
 * whose default is 1 — but the EasyEyes renderer is created with
 * `resolution: devicePixelRatio` (or a setResolution-derived value). A
 * filter at resolution 1 renders its subtree into an intermediate texture
 * at CSS-pixel density and then upscales it, which blurs everything passing
 * through the filter (text, background, the whole scene through the dither
 * pass) and makes the dither noise chunky (one noise sample per LOW-res
 * texel). Matching the renderer's resolution keeps the intermediate
 * texel grid identical to the backbuffer's pixel grid, so the colorize
 * pass is a pixel-exact copy and the dither noise is per device pixel.
 *
 * Set per-filter (NOT via the global PIXI.settings.FILTER_RESOLUTION), so
 * no other PsychoJS filter user shifts behavior underneath us.
 */
export const currentFilterResolution = () =>
	(state.renderer && state.renderer.resolution) || 1;

const makeColorizeFilter = (rgb = [1, 1, 1]) => {
	const filter = new PIXI.Filter(undefined, COLORIZE_FRAG, {
		uColorRGB: new Float32Array(rgb),
	});
	filter.resolution = currentFilterResolution();
	return filter;
};

const makeDitherFilter = (lsb) => {
	const filter = new PIXI.Filter(undefined, DITHER_FRAG, {
		uSeed: 0.0,
		uLsb: lsb,
	});
	filter.resolution = currentFilterResolution();
	return filter;
};

// ---------------------------- configuration ----------------------------

/**
 * Configure the pipeline. Must be called BEFORE the PsychoJS Window (and
 * therefore the PIXI renderer) is created. Unknown fields are ignored.
 */
export const configureColorPipeline = ({
	colorSpace,
	float16Bool,
	ditherBool,
	ditherLsb,
} = {}) => {
	if (colorSpace === "srgb" || colorSpace === "display-p3")
		config.colorSpace = colorSpace;
	if (typeof float16Bool === "boolean") config.float16Bool = float16Bool;
	if (typeof ditherBool === "boolean") config.ditherBool = ditherBool;
	if (typeof ditherLsb === "number" && ditherLsb > 0 && ditherLsb < 1)
		config.ditherLsb = ditherLsb;
};

export const getColorPipelineConfig = () => ({ ...config });

const pipelineRequested = () =>
	config.colorSpace !== "srgb" || config.float16Bool || config.ditherBool;

// ------------------------------- apply ---------------------------------

/**
 * Apply the configured pipeline to a freshly created PIXI renderer.
 * Call from Window._setupPixi immediately after the renderer and the root
 * container exist. Safe to call repeatedly (renderer re-creation).
 *
 * @param {PIXI.Renderer} renderer - the PIXI renderer (WebGL)
 * @param {PIXI.Container} rootContainer - the Window's root container
 */
export const applyColorPipelineToRenderer = (renderer, rootContainer) => {
	// Fresh state for (re)created renderers.
	state.applied = false;
	state.renderer = renderer;
	state.colorSpaceApplied = "srgb";
	state.drawingBufferFloat = false;
	state.floatFilterTextures = false;
	state.floatColorActive = false;
	state.ditherActive = false;
	state.backgroundQuad = null;
	state.ditherFilter = null;
	state.failures = [];

	if (!pipelineRequested()) return;

	const gl = renderer.gl;
	if (!gl) {
		state.failures.push("no WebGL context (canvas renderer fallback)");
		return;
	}

	state.applied = true;

	// (1) Tag the drawing buffer's color space. The browser then converts
	// buffer values from that space to the display's ICC profile.
	if (config.colorSpace !== "srgb") {
		if ("drawingBufferColorSpace" in gl) {
			try {
				gl.drawingBufferColorSpace = config.colorSpace;
			} catch (e) {
				/* leave failure recorded below */
			}
			// Browsers keep the property unchanged if the value is unsupported.
			if (gl.drawingBufferColorSpace === config.colorSpace)
				state.colorSpaceApplied = config.colorSpace;
			else state.failures.push(`colorSpace ${config.colorSpace} rejected`);
		} else {
			state.failures.push("drawingBufferColorSpace unsupported");
		}
	}

	// (2b) float16 intermediate textures for PIXI's filter pipeline, so the
	// composite that feeds the dither pass (and any filtered stim) is not
	// quantized to 8 bits. HALF_FLOAT textures are filterable in core
	// WebGL2; renderability requires EXT_color_buffer_(half_)float.
	const wantFloatIntermediates = config.float16Bool || config.ditherBool;
	if (wantFloatIntermediates) {
		const renderableFloat =
			!!gl.getExtension("EXT_color_buffer_float") ||
			!!gl.getExtension("EXT_color_buffer_half_float");
		if (renderableFloat && renderer.filter && renderer.filter.texturePool) {
			renderer.filter.texturePool.textureOptions.type = PIXI.TYPES.HALF_FLOAT;
			state.floatFilterTextures = true;
		} else {
			state.failures.push("float16 render textures unsupported");
		}
	}

	// (2a) float16 backbuffer (Chromium 122+).
	if (config.float16Bool) {
		if (
			typeof gl.drawingBufferStorage === "function" &&
			typeof gl.RGBA16F !== "undefined"
		) {
			// RGBA16F requires EXT_color_buffer_float to be ENABLED first, or
			// drawingBufferStorage generates INVALID_ENUM. PIXI already enables
			// it for WebGL2 contexts, but do not depend on that.
			gl.getExtension("EXT_color_buffer_float") ||
				gl.getExtension("EXT_color_buffer_half_float");
			try {
				// Drain stale errors so getError below reports only our call.
				while (gl.getError() !== gl.NO_ERROR) {}
				gl.drawingBufferStorage(gl.RGBA16F, gl.canvas.width, gl.canvas.height);
				// drawingBufferStorage reports failure through the GL error queue,
				// not by throwing, so a silent fallback is otherwise invisible.
				const glError = gl.getError();
				state.drawingBufferFloat =
					glError === gl.NO_ERROR &&
					(typeof gl.drawingBufferFormat === "undefined" ||
						gl.drawingBufferFormat === gl.RGBA16F);
				if (!state.drawingBufferFloat)
					state.failures.push(
						`drawingBufferStorage(RGBA16F) rejected (glError 0x${glError.toString(16)})`,
					);
			} catch (e) {
				state.failures.push(`drawingBufferStorage failed: ${e.message}`);
			}
		} else {
			state.failures.push("drawingBufferStorage unsupported");
		}
	}

	

	// Float color path for text/background: worthwhile whenever the value
	// can survive past 8 bits — into a float backbuffer, or into the float
	// intermediate that the dither pass quantizes smartly.
	state.floatColorActive =
		state.drawingBufferFloat || (config.ditherBool && state.floatFilterTextures);

	// (2c) Full-screen background quad carrying the float background color.
	// PIXI's clear color is 8-bit quantized (backgroundColor int); a WHITE
	// sprite × ColorizeFilter is exact. Inserted at index 0 so every stim
	// draws above it; included in the root container so the dither filter
	// (applied to the container) also dithers the background.
	if (state.floatColorActive) {
		const quad = new PIXI.Sprite(PIXI.Texture.WHITE);
		quad.anchor.set(0.5);
		quad.name = "ee-colorPipeline-background";
		// Seed with the renderer's current (8-bit-quantized) clear color so
		// the very first frame — before any syncBackgroundColor call — shows
		// the window background, not white.
		quad.filters = [
			makeColorizeFilter(
				renderer._backgroundColorRgba
					? renderer._backgroundColorRgba.slice(0, 3)
					: [0, 0, 0],
			),
		];
		rootContainer.addChildAt(quad, 0);
		state.backgroundQuad = quad;
	}

	// (3) Noisy-bit dither as the final full-screen pass.
	if (config.ditherBool && state.floatFilterTextures) {
		state.ditherFilter = makeDitherFilter(config.ditherLsb);
		rootContainer.filterArea = renderer.screen;
		rootContainer.filters = [state.ditherFilter];
		state.ditherActive = true;
	} else if (config.ditherBool) {
		state.failures.push("dither disabled (no float16 render textures)");
	}

	resizeColorPipeline(renderer);
};

/**
 * Re-establish size-dependent pieces after the renderer resizes:
 * the float16 backbuffer format (resizing the canvas may reset it) and the
 * background quad's dimensions. renderer.screen is mutated in place by
 * PIXI, so the dither filterArea needs no update.
 */
export const resizeColorPipeline = (renderer) => {
	if (!state.applied || state.renderer !== renderer) return;
	const gl = renderer.gl;
	if (state.drawingBufferFloat && gl && typeof gl.drawingBufferStorage === "function") {
		try {
			gl.drawingBufferStorage(gl.RGBA16F, gl.canvas.width, gl.canvas.height);
		} catch (e) {
			/* keep previous format */
		}
	}
	if (state.backgroundQuad) {
		state.backgroundQuad.width = renderer.screen.width;
		state.backgroundQuad.height = renderer.screen.height;
		state.backgroundQuad.position.set(0, 0);
	}
};

// ----------------------------- per-frame -------------------------------

/**
 * Advance the dither noise (new seed every frame). Call once per flip,
 * before rendering.
 */
export const advanceDitherFrame = () => {
	if (!state.ditherActive) return;
	state.frame = (state.frame + 1) % 100000;
	// Irrational stride decorrelates consecutive frames' noise fields.
	state.ditherFilter.uniforms.uSeed = 1.0 + (state.frame * 0.618034) % 61.8034;
};

// ------------------------------- colors --------------------------------

/**
 * True when TextStim should rasterize glyphs white and carry color through
 * a float-uniform filter (see TextStim._getTextStyle / _updateIfNeeded).
 */
export const floatTextColorActive = () => state.floatColorActive;

/**
 * Attach/refresh the float color filter on a PIXI display object (text).
 * No-op (and cleanup) when the float color path is inactive.
 *
 * @param {PIXI.DisplayObject} pixiObj
 * @param {module:util.Color} color - psychojs Color; .rgb is [0,1] floats
 */
export const syncTextColorFilter = (pixiObj, color) => {
	if (!pixiObj) return;
	if (!state.floatColorActive) {
		if (pixiObj.__eeColorizeFilter) {
			pixiObj.filters = null;
			delete pixiObj.__eeColorizeFilter;
		}
		return;
	}
	const rgb = color.rgb;
	let filter = pixiObj.__eeColorizeFilter;
	if (!filter) {
		filter = makeColorizeFilter(rgb);
		pixiObj.__eeColorizeFilter = filter;
		pixiObj.filters = [filter];
	} else {
		filter.uniforms.uColorRGB[0] = rgb[0];
		filter.uniforms.uColorRGB[1] = rgb[1];
		filter.uniforms.uColorRGB[2] = rgb[2];
		// Cached filters can outlive a renderer re-creation with a different
		// resolution (Window.changeResolution) — keep them at the current
		// renderer's resolution so the filter texture stays pixel-exact.
		filter.resolution = currentFilterResolution();
		if (!pixiObj.filters || pixiObj.filters.indexOf(filter) === -1)
			pixiObj.filters = [filter];
	}
};

/**
 * Keep the background exact: float clear color on the renderer (bypasses
 * PIXI's 8-bit backgroundColor int) and the background quad's filter color.
 * Call whenever the window background color changes.
 *
 * @param {PIXI.Renderer} renderer
 * @param {module:util.Color} color - psychojs Color
 */
export const syncBackgroundColor = (renderer, color) => {
	if (!state.applied || state.renderer !== renderer) return;
	const rgb = color.rgb;
	// _backgroundColorRgba is the float array PIXI hands to gl.clearColor
	// (RenderTextureSystem.clear); the backgroundColor int setter quantizes,
	// so overwrite with full-precision floats afterwards.
	if (renderer._backgroundColorRgba) {
		renderer._backgroundColorRgba[0] = rgb[0];
		renderer._backgroundColorRgba[1] = rgb[1];
		renderer._backgroundColorRgba[2] = rgb[2];
	}
	if (state.backgroundQuad) {
		const uniforms = state.backgroundQuad.filters[0].uniforms;
		uniforms.uColorRGB[0] = rgb[0];
		uniforms.uColorRGB[1] = rgb[1];
		uniforms.uColorRGB[2] = rgb[2];
	}
};

/**
 * CSS color string for the document body matching the canvas background.
 * In display-p3 mode the body must be tagged with the same space so the
 * area around/behind the canvas matches the canvas exactly.
 * Legacy hex when the pipeline is off (byte-identical old behavior).
 */
export const cssBodyColor = (color) => {
	try {
		if (!state.applied || state.colorSpaceApplied !== "display-p3")
			return color.hex;
		const [r, g, b] = color.rgb;
		return `color(display-p3 ${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)})`;
	} catch (e) {
		return color.hex;
	}
};

// ------------------------------ readback -------------------------------

/**
 * Read one pixel of the drawing buffer, honoring its storage format
 * (readPixels type must match: UNSIGNED_BYTE for 8-bit, FLOAT for RGBA16F).
 * Returns [r, g, b, a] normalized to [0,1].
 */
export const readDrawingBufferPixel = (gl, x, y) => {
	if (state.drawingBufferFloat) {
		const px = new Float32Array(4);
		gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, px);
		return [px[0], px[1], px[2], px[3]];
	}
	const px = new Uint8Array(4);
	gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
	return [px[0] / 255, px[1] / 255, px[2] / 255, px[3] / 255];
};

/**
 * True when the drawing buffer holds float16 (RGBA16F) storage, so callers
 * that do their own readPixels pick the matching type. Single source of
 * truth — do not re-derive it from gl.drawingBufferFormat, which is absent
 * on browsers older than Chromium 122 and would then disagree with the
 * type this module actually used.
 */
export const drawingBufferIsFloat = () => state.drawingBufferFloat;

/**
 * Read a rectangle of the drawing buffer, honoring its storage format.
 * Returns a Float32Array of w*h RGBA quadruplets normalized to [0,1]
 * (values may exceed 1 on a float16 buffer). Origin is bottom-left, as
 * for gl.readPixels.
 */
export const readDrawingBufferRect = (gl, x, y, width, height) => {
	const n = 4 * width * height;
	if (state.drawingBufferFloat) {
		const px = new Float32Array(n);
		gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, px);
		return px;
	}
	const bytes = new Uint8Array(n);
	gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
	const px = new Float32Array(n);
	for (let i = 0; i < n; i++) px[i] = bytes[i] / 255;
	return px;
};

/**
 * The 1×1 readback Window.render() issues to make sure the GPU is done
 * rendering — format-aware replacement for the historical hardcoded
 * UNSIGNED_BYTE read (which is a GL error on a float16 backbuffer).
 */
export const syncGpuReadback = (gl) => {
	readDrawingBufferPixel(gl, 0, 0);
};

// ------------------------------- report --------------------------------

/**
 * Snapshot of requested vs. achieved pipeline state plus display/environment
 * facts, for logging to the console and the experiment's results CSV.
 */
export const getColorPipelineReport = () => {
	const mq = (q) => {
		try {
			return typeof window !== "undefined" && window.matchMedia
				? window.matchMedia(q).matches
				: undefined;
		} catch (e) {
			return undefined;
		}
	};
	return {
		requested: { ...config },
		applied: state.applied,
		colorSpace: state.colorSpaceApplied,
		float16Backbuffer: state.drawingBufferFloat,
		floatFilterTextures: state.floatFilterTextures,
		floatColorPath: state.floatColorActive,
		dither: state.ditherActive,
		ditherLsb: config.ditherLsb,
		// Live filter resolutions (must equal rendererResolution; PIXI's
		// default of 1 renders filters at CSS-pixel density and upscales —
		// blurry stimuli, chunky dither noise).
		rendererResolution: state.renderer ? state.renderer.resolution : undefined,
		ditherFilterResolution: state.ditherFilter
			? state.ditherFilter.resolution
			: undefined,
		backgroundFilterResolution:
			state.backgroundQuad && state.backgroundQuad.filters
				? state.backgroundQuad.filters[0].resolution
				: undefined,
		failures: state.failures.slice(),
		displayP3Gamut: mq("(color-gamut: p3)"),
		rec2020Gamut: mq("(color-gamut: rec2020)"),
		dynamicRangeHigh: mq("(dynamic-range: high)"),
		devicePixelRatio:
			typeof window !== "undefined" ? window.devicePixelRatio : undefined,
	};
};
