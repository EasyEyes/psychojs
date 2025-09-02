/**
 * Text Stimulus.
 *
 * @author Alain Pitiot
 * @version 2021.2.0
 * @copyright (c) 2017-2020 Ilixa Ltd. (http://ilixa.com) (c) 2020-2021 Open Science Tools Ltd. (https://opensciencetools.org)
 * @license Distributed under the terms of the MIT License
 */

import * as PIXI from "pixi.js-legacy";
import { Color } from "../util/Color.js";
import { ColorMixin } from "../util/ColorMixin.js";
import { to_pixiPoint } from "../util/Pixi.js";
import * as util from "../util/Util.js";
import { VisualStim } from "./VisualStim.js";

/**
 * @name module:visual.TextStim
 * @class
 * @extends VisualStim
 * @mixes ColorMixin
 * @param {Object} options
 * @param {String} options.name - the name used when logging messages from this stimulus
 * @param {module:core.Window} options.win - the associated Window
 * @param {string} [options.text="Hello World"] - the text to be rendered
 * @param {string} [options.font= "Arial"] - the font family
 * @param {Array.<number>} [options.pos= [0, 0]] - the position of the center of the text
 * @param {Color} [options.color= 'white'] the background color
 * @param {number} [options.opacity= 1.0] - the opacity
 * @param {number} [options.depth= 0] - the depth (i.e. the z order)
 * @param {number} [options.contrast= 1.0] - the contrast
 * @param {string} [options.units= "norm"] - the units of the text size and position
 * @param {number} options.ori - the orientation (in degrees)
 * @param {number} [options.height= 0.1] - the height of the text
 * @param {boolean} [options.bold= false] - whether or not the text is bold
 * @param {boolean} [options.italic= false] - whether or not the text is italic
 * @param {string} [options.alignHoriz = 'center'] - horizontal alignment
 * @param {string} [options.alignVert = 'center'] - vertical alignment
 * @param {boolean} options.wrapWidth - whether or not to wrap the text horizontally
 * @param {boolean} [options.flipHoriz= false] - whether or not to flip the text horizontally
 * @param {boolean} [options.flipVert= false] - whether or not to flip the text vertically
 * @param {PIXI.Graphics} [options.clipMask= null] - the clip mask
 * @param {boolean} [options.autoDraw= false] - whether or not the stimulus should be automatically drawn on every frame flip
 * @param {boolean} [options.autoLog= false] - whether or not to log
 * @param {boolean} isInstruction
 * @param {number} padding [options.padding = 0] - Multiplier (ie multiplied by `height`) to get px padding of stim, used for expansive fonts
 * @param {string} characterSet
 * @param {number} letterSpacing - letter spacing aka letter tracking
 * @param {string} [options.renderMethod= "1"] - the rendering method ("1" for standard PIXI text (EasyEyesRenderVersion==1), "2" (EasyEyesRenderVersion==2) for SVG-to-image rendering)
 * @param {string} [options.fontVariationSettings=""]
 * 
 *
 * @todo vertical alignment, and orientation are currently NOT implemented
 */
export class TextStim extends util.mix(VisualStim).with(ColorMixin)
{
	constructor(
		{
			name,
			win,
			text,
			font,
			pos,
			color,
			opacity,
			depth,
			contrast,
			units,
			ori,
			height,
			bold,
			italic,
			alignHoriz,
			alignVert,
			wrapWidth,
			flipHoriz,
			flipVert,
			clipMask,
			autoDraw,
			autoLog,
			isInstruction = false,
			padding = 0,
			characterSet = "|ÉqÅ",
			letterSpacing,
			medialShape,
			renderMethod = "1",
			fontVariationSettings = "",
		} = {},
	)
	{
		super({ name, win, units, ori, opacity, depth, pos, clipMask, autoDraw, autoLog });
		
		// callback to deal with text metrics invalidation:
		const onChange = (withPixi = false, withBoundingBox = false, withMetrics = false) =>
		{
			const visualOnChange = this._onChange(withPixi, withBoundingBox);
			return () =>
			{
				visualOnChange();
				if (withMetrics)
				{
					this._textMetrics = undefined;
				}
			};
		};

		// Instruction text
		this._isInstruction = isInstruction || false

		this._addAttribute(
			"characterSet",
			characterSet,
			"|ÉqÅ",
			onChange(true, true, true),
		);
		// text and font:
		this._addAttribute(
			"text",
			text,
			"Hello World",
			onChange(true, true, true),
		);
		this._addAttribute(
			"alignHoriz",
			alignHoriz,
			"center",
			onChange(true, true, true),
		);
		this._addAttribute(
			"alignVert",
			alignVert,
			"center",
			onChange(true, true, true),
		);
		this._addAttribute(
			"flipHoriz",
			flipHoriz,
			false,
			onChange(true, true, true),
		);
		this._addAttribute(
			"flipVert",
			flipVert,
			false,
			onChange(true, true, true),
		);
		this._addAttribute(
			"font",
			font,
			"Arial",
			this._onChange(true, true),
		);
		this._addAttribute(
			"letterSpacing",
			letterSpacing, 
			0, 
			onChange(true, true, true));	 
		this._addAttribute(
			"height",
			height,
			this._getDefaultLetterHeight(),
			onChange(true, true, true),
		);
		this._addAttribute(
			"padding",
			 padding, 
			 0, 
			 onChange(true, true, true));
		this._addAttribute(
			"wrapWidth",
			wrapWidth,
			this._getDefaultWrapWidth(),
			onChange(true, true, true),
		);
		this._addAttribute(
			"bold",
			bold,
			false,
			onChange(true, true, true),
		);
		this._addAttribute(
			"italic",
			italic,
			false,
			onChange(true, true, true),
		);
		this._addAttribute(
			"color",
			color,
			"white"
			// this._onChange(true, false)
		);
		this._addAttribute(
			"contrast",
			contrast,
			1.0,
			this._onChange(true, false, false),
		);
		this._addAttribute(
			"medialShape", 
			medialShape, 
			false, 
			this._onChange(true, true, true)
		); 
		this._addAttribute(
			"renderMethod",
			renderMethod,
			"1",
			onChange(true, true, true),
		);
		this._addAttribute(
			"fontVariationSettings",
			fontVariationSettings,
			"",
			onChange(true, true, true),
		);
    

		// estimate the bounding box (using TextMetrics):
		// this._estimateBoundingBox();

    // this.fontRenderMaxScalar = 1;
    
		if (this._autoLog)
		{
			this._psychoJS.experimentLogger.exp(`Created ${this.name} = ${this.toString()}`);
		}
		//const text_style = this._getTextStyle(true, false);
		//PIXI.BitmapFont.from(this._font, text_style);
	}

	/**
	 * Get the metrics estimated for the text and style.
	 *
	 * Note: getTextMetrics does not require the PIXI representation of the stimulus
	 * to be instantiated, unlike getSize().
	 *
	 * @name module:visual.TextStim#getTextMetrics
	 * @public
	 */
	getTextMetrics(baseline="alphabetic", textAlign="left")
	{
		if (typeof this._textMetrics === "undefined")
		{
			PIXI.TextMetrics.BASELINE_MULTIPLIER = 8;// 8 // 1.4
			PIXI.TextMetrics.HEIGHT_MULTIPLIER = 12; // 12 // 2 
			// PIXI.TextMetrics.BASELINE_SYMBOL = 'M';
			PIXI.TextMetrics.METRICS_STRING = this._characterSet;
      		this._textMetrics = PIXI.TextMetrics.measureText(this.getText(), this._getTextStyle());
			try {
				this._textMetrics = PIXI.TextMetrics.measureText(this.getText(), this._getTextStyle(false));
				this._textMetrics.frmpLimitedTextMetrics = false;
			} catch (e) {
				this._textMetrics = PIXI.TextMetrics.measureText(this.getText(), this._getTextStyle());
				// Using an approximated textMetrics, ie scaled down by this.fontRenderMaxScalar
				this._textMetrics.frmpLimitedTextMetrics = true;
			}
			
			// since PIXI.TextMetrics does not give us the actual bounding box of the text
			// (e.g. the height is really just the ascent + descent of the font), we use measureText:
			const textMetricsCanvas = document.createElement('canvas');
			document.body.appendChild(textMetricsCanvas);

			const ctx = textMetricsCanvas.getContext("2d");
			ctx.font = this._getTextStyle().toFontString();
			ctx.textBaseline = baseline;
			ctx.textAlign = textAlign;
			// https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing
			ctx.letterSpacing = `${this._letterSpacing}px`;
			this._textMetrics.boundingBox = ctx.measureText(this.getText());
			try {
				ctx.font = this._getTextStyle(false).toFontString();
				this._textMetrics.boundingBox = ctx.measureText(this.getText());
				// frmp = fontRenderMaxPx
				this._textMetrics.frmpLimitedBoundingBox = false;
			} catch (e) {
				ctx.font = this._getTextStyle().toFontString();
				this._textMetrics.boundingBox = ctx.measureText(this.getText());
				this._textMetrics.frmpLimitedBoundingBox = true;
			}

			document.body.removeChild(textMetricsCanvas);
		}

		return this._textMetrics;
	}

	/**
	 * Get the default letter height given the stimulus' units.
	 *
	 * @name module:visual.TextStim#_getDefaultLetterHeight
	 * @protected
	 * @return {number} - the letter height corresponding to this stimulus' units.
	 */
	_getDefaultLetterHeight()
	{
		const height = TextStim._defaultLetterHeightMap.get(this._units);

		if (typeof height === "undefined")
		{
			throw {
				origin: "TextStim._getDefaultLetterHeight",
				context: "when getting the default height of TextStim: " + this._name,
				error: "no default letter height for unit: " + this._units,
			};
		}

		return height;
	}

	/**
	 * Get the default wrap width given the stimulus' units.
	 *
	 * @name module:visual.TextStim#_getDefaultWrapWidth
	 * @protected
	 * @return {number} - the wrap width corresponding to this stimulus' units.
	 */
	_getDefaultWrapWidth()
	{
		const wrapWidth = TextStim._defaultWrapWidthMap.get(this._units);

		if (typeof wrapWidth === "undefined")
		{
			throw {
				origin: "TextStim._getDefaultWrapWidth",
				context: "when getting the default wrap width of TextStim: " + this._name,
				error: "no default wrap width for unit: " + this._units,
			};
		}

		return wrapWidth;
	}

	/**
	 * Get the bounding box.
	 *
	 * @name module:visual.TextStim#getBoundingBox
	 * @public
	 * @param {boolean} [tight= false] - whether or not to fit as closely as possible to the text
	 * @return {number[]} - the bounding box, in the units of this TextStim
	 */
	getBoundingBox(tight = false)
	{
		if (tight)
		{
      this._updateIfNeeded();
			const textMetrics_px = this.getTextMetrics();
      // const boundingBoxLeft = textMetrics_px.frmpLimitedBoundingBox ? 
        // textMetrics_px.boundingBox.actualBoundingBoxLeft*this.fontRenderMaxScalar : 
		const boundingBoxLeft = textMetrics_px.boundingBox.actualBoundingBoxLeft;
      // const fontPropertiesDescent = textMetrics_px.frmpLimitedTextMetrics ? 
       // textMetrics_px.fontProperties.descent * this.fontRenderMaxScalar :
       const fontPropertiesDescent = textMetrics_px.fontProperties.descent;
      //const boundingBoxDescent = textMetrics_px.frmpLimitedBoundingBox ?
        // textMetrics_px.boundingBox.actualBoundingBoxDescent * this.fontRenderMaxScalar :
        const boundingBoxDescent = textMetrics_px.boundingBox.actualBoundingBoxDescent;
      //const boundingBoxRight = textMetrics_px.frmpLimitedBoundingBox ?
        //textMetrics_px.boundingBox.actualBoundingBoxRight * this.fontRenderMaxScalar :
		const boundingBoxRight = textMetrics_px.boundingBox.actualBoundingBoxRight;
      // const boundingBoxAscent = textMetrics_px.frmpLimitedBoundingBox ?
        // textMetrics_px.boundingBox.actualBoundingBoxAscent * this.fontRenderMaxScalar :
        const boundingBoxAscent = textMetrics_px.boundingBox.actualBoundingBoxAscent
			let left_px = this._pos[0] - boundingBoxLeft;
			let top_px = this._pos[1] + fontPropertiesDescent - boundingBoxDescent;
			const width_px = boundingBoxRight + boundingBoxLeft;
			const height_px = boundingBoxAscent + boundingBoxDescent;

			// adjust the bounding box position by taking into account the anchoring of the text:
			const boundingBox_px = this._getBoundingBox_px();
			switch (this._alignHoriz)
			{
				case "left":
					// nothing to do
					break;
				case "right":
					// TODO
					break;
				default:
				case "center":
					left_px -= (boundingBox_px.width - width_px) / 2;
			}
			switch (this._alignVert)
			{
				case "top":
					// TODO
					break;
				case "bottom":
					// nothing to do
					break;
				default:
				case "center":
					top_px -= (boundingBox_px.height - height_px) / 2;
			}

			// convert from pixel to this stimulus' units:
			const leftTop = util.to_unit(
				[left_px, top_px],
				"pix",
				this._win,
				this._units);
			const dimensions = util.to_unit(
				[width_px, height_px],
				"pix",
				this._win,
				this._units);

			return new PIXI.Rectangle(leftTop[0], leftTop[1], dimensions[0], dimensions[1]);
		}
		else
		{
			return this._boundingBox.clone();
		}
	}

	/**
	 * Estimate the bounding box.
	 *
	 * @name module:visual.TextStim#_estimateBoundingBox
	 * @protected
	 * @override
	 */
	_estimateBoundingBox()
	{
		// size of the text, irrespective of the orientation:
		const textMetrics = this.getTextMetrics();
		const textSize = util.to_unit(
			[textMetrics.width, textMetrics.height],
			"pix",
			this._win,
			this._units,
		);

		// take the alignment into account:
		const anchor = this._getAnchor();
		this._boundingBox = new PIXI.Rectangle(
			this._pos[0] - anchor[0] * textSize[0],
			this._pos[1] - textSize[1] + anchor[1] * textSize[1],
			textSize[0],
			textSize[1],
		);

		// TODO take the orientation into account
	}

	/**
	 * Get the PIXI Text Style applied to the PIXI.Text
	 *
	 * @name module:visual.TextStim#_getTextStyle
	 * @protected
	 */
	_getTextStyle(downscale=false, useStringForFontSize=true) //adding new para since BitmapFont.from() requires fontSize to be a number instead of a string
	{
		let h = this._height;
		// if (this._psychoJS?.fontRenderMaxPx && h > this._psychoJS.fontRenderMaxPx) {
		//   this.fontRenderMaxScalar = Math.ceil(h / this._psychoJS.fontRenderMaxPx)
		// }
		// if (downscale) h = h/this.fontRenderMaxScalar;
		let fontSize = Math.round(this._getLengthPix(h)); 
		if (useStringForFontSize) { // BitmapFont.from() requires fontSize to be a number instead of a string
			if (this._isInstruction) {
				fontSize = fontSize + "pt";
			} else {
				fontSize = fontSize + "px";
			}
		}
		return new PIXI.TextStyle({
			fontFamily: this._font,
			fontSize: fontSize,
			fontWeight: (this._bold) ? "bold" : "normal",
			fontStyle: (this._italic) ? "italic" : "normal",
			fill: this.getContrastedColor(new Color(this._color), this._contrast).hex,
			align: this._alignHoriz,
			wordWrap: (typeof this._wrapWidth !== "undefined"),
			wordWrapWidth: (typeof this._wrapWidth !== "undefined") ? this._getHorLengthPix(this._wrapWidth) : 0,
			breakWords: this._isInstruction,
			padding: this._padding * h || 0,
			letterSpacing: this._letterSpacing,
		});
	}

	/**
	 * Get CSS styles for HTML-based text rendering (SVG method).
	 *
	 * @name module:visual.TextStim#_getCSSTextStyle
	 * @protected
	 * @return {Object} CSS style properties for HTML div element
	 */
	_getCSSTextStyle()
	{
		const fontSize = Math.round(this._getLengthPix(this._height));
		const textColor = this.getContrastedColor(new Color(this._color), this._contrast).hex;
		const fontFamily = this._font.replace(/\.[^.]+$/, "");

		// Convert letter spacing from PIXI format to CSS
		const letterSpacingCSS = this._letterSpacing ? this._letterSpacing + "px" : "normal";
		
		// Convert padding to CSS format
		const paddingCSS = (this._padding * fontSize || 0) + "px";
		
		// Map PIXI alignment to CSS text-align
		let textAlign;
		switch (this._alignHoriz) {
			case "left":
				textAlign = "left";
				break;
			case "right":
				textAlign = "right";
				break;
			case "center":
			default:
				textAlign = "center";
				break;
		}
		
		// Handle word wrapping
		const whiteSpace = (typeof this._wrapWidth !== "undefined") ? "normal" : "nowrap";
		const wordWrapWidth = (typeof this._wrapWidth !== "undefined") ? this._getHorLengthPix(this._wrapWidth) : null;
		
		// Handle word breaking for instruction text
		const wordBreak = this._isInstruction ? "break-word" : "normal";
		
		// Build CSS style object
		const cssStyle = {
			fontFamily,
			fontSize: fontSize + "px",
			fontWeight: this._bold ? "bold" : "normal",
			fontStyle: this._italic ? "italic" : "normal",
			color: textColor,
			textAlign,
			letterSpacing: letterSpacingCSS,
			padding: paddingCSS,
			margin: "0",
			whiteSpace,
			wordBreak,
			lineHeight: "normal",
			boxSizing: "border-box",
			fontVariationSettings: this._fontVariationSettings,
		};
		console.log("!. font-variation-settings", this._fontVariationSettings);
		
		// Add width constraint if word wrapping is enabled
		if (wordWrapWidth !== null) {
			cssStyle.width = wordWrapWidth + "px";
		}
		
		return cssStyle;
	}



	/**
	 * Setter for the color attribute.
	 *
	 * @name module:visual.TextStim#setColor
	 * @public
	 * @param {undefined | null | number} color - the color
	 * @param {boolean} [log= false] - whether of not to log
	 */
	setColor(color, log = false)
	{
		const hasChanged = this._setAttribute("color", color, log);

		if (hasChanged)
		{
			if (typeof this._pixi !== "undefined")
			{
				this._pixi.style = this._getTextStyle();
				this._needUpdate = true;
			}
		}
	}

	/**
	 * Keeping with the convention defined in the EE glossary, `padding` is
	 * a scalar, that will be multiplied by height when applied (ie in this.getTextStyle).
	 * Previously it was necessary to write out this function, now it's redundant (ie it
	 * just does the default behavior)
	 * @param {Number} padding 
	 * @param {Boolean} log 
	 */
	// setPadding(padding, log = false)
	// {
	// 	const hasChanged = this._setAttribute("padding", padding, log);

	// 	if (hasChanged)
	// 	{
	// 		if (typeof this._pixi !== "undefined")
	// 		{
	// 			this._pixi.style = this._getTextStyle();
	// 			this._needUpdate = true;
	// 		}
	// 	}
	// }

	/**
	 * Setter for the letterSpacing attribute 
	 * Not currently in use, but maintaining this method for possible future use.
	 *
	 * @name module:visual.TextStim#setLetterSpacing
	 * @public
	 * @param {undefined | number} spacing - letter spacing in pixels
	 * @param {boolean} [log= false] - whether of not to log
	 */
	setLetterSpacing(spacing = 0, log = false)
	{
		// Must use _setAttribute method when updating an attribute to trigger onChange() and update the stim
		const hasChanged = this._setAttribute("letterSpacing", spacing, log);

		if (hasChanged)
		{
			if (typeof this._pixi !== "undefined")
			{
				this._pixi.style = this._getTextStyle();
				this._needUpdate = true;
			}
		}
	}

	/**
	 * Setter for the letterSpacing attribute used for letterTracking
	 *
	 * @name module:visual.TextStim#setLetterSpacingByProportion
	 * @public
	 * @param {undefined | number} spacing - letter spacing where the value changes the spacing in
	 * proportion of the font size, that is, 0.5 will create letter spacing of about half of the 
	 * font size.
	 * @param {boolean} [log= false] - whether of not to log
	 */
	setLetterSpacingByProportion(spacing = 0, log = false)
	{
		let prop_spacing = spacing * this.height;
		this.setLetterSpacing(prop_spacing, log);
	}

	/**
	 * Get the actual bounding box of rendered content by analyzing pixels.
	 * Used when EasyEyesRenderMethod==2, as we can't rely on measureText/textMetrics
	 * (ie canvas 2d representation does not support variable fonts) 
	 *
	 * @name module:visual.TextStim#_getDerivedBoundingBox
	 * @protected
	 * @param {HTMLCanvasElement} canvas - canvas to analyze
	 * @return {Object|null} bounding box with topLeft and bottomRight coordinates, or null if no content
	 */
	_getDerivedBoundingBox(canvas)
	{
		const ctx = canvas.getContext('2d');
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const data = imageData.data;
		
		let minX = canvas.width;
		let minY = canvas.height;
		let maxX = -1;
		let maxY = -1;
		
		// Scan all pixels to find non-transparent, non-white content
		for (let y = 0; y < canvas.height; y++) {
			for (let x = 0; x < canvas.width; x++) {
				const index = (y * canvas.width + x) * 4;
				const r = data[index];     // Red channel
				const g = data[index + 1]; // Green channel
				const b = data[index + 2]; // Blue channel
				const alpha = data[index + 3]; // Alpha channel
				
				// Check if pixel is not transparent and not white background
				if (alpha > 0 && (r !== 255 || g !== 255 || b !== 255)) {
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}
		
		// Return null if no content found
		if (maxX === -1) {
			return null;
		}
		
		return {
			topLeft: { x: minX, y: minY },
			bottomRight: { x: maxX, y: maxY },
		};
	}

	/**
	 * Create SVG-based text as an image for PIXI Sprite rendering.
	 *
	 * @name module:visual.TextStim#_createSVGTextImage
	 * @protected
	 * @return {Promise<{canvas: HTMLCanvasElement, boundingBox: Object}>} - canvas and its actual bounding box
	 */
	async _createSVGTextImage()
	{
		const cssStyle = this._getCSSTextStyle();
		const textContent = this.getText();
		
		// Create SVG with foreign object containing HTML text
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		const foreignObject = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
		const div = document.createElement("div");

		const fontURL = this._getFontURL();
        if (fontURL) {
            const style = document.createElementNS("http://www.w3.org/2000/svg", 'style');
            
            // Determine font format
            const ext = fontURL.toLowerCase().split('.').pop();
            let format = 'woff2';
            if (ext === 'woff') format = 'woff';
            else if (ext === 'ttf') format = 'truetype';
            else if (ext === 'otf') format = 'opentype';
            
            // Create @font-face with variations support for variable fonts
            const cleanFontName = this._font.replace(/\.[^.]+$/, "");
            style.textContent = `@font-face {
                font-family: '${cleanFontName}';
                src: url("${fontURL}") format('${format} supports variations'),
                     url("${fontURL}") format('${format}-variations'),
                     url("${fontURL}") format('${format}');
            }`;
            svg.appendChild(style);
            
            // Wait for font to be available
            try {
                await document.fonts.load(`${cssStyle.fontSize} ${cleanFontName}`);
            } catch (e) {
                console.warn("Font loading failed:", e);
            }
        }

		// Apply CSS styles to the div
		Object.assign(div.style, cssStyle);
		div.textContent = textContent;
		
		// Measure text dimensions using DOM measurement
		const measureDiv = div.cloneNode(true);
		measureDiv.style.position = "absolute";
		measureDiv.style.visibility = "hidden";
		measureDiv.style.top = "-9999px";
		document.body.appendChild(measureDiv);
		console.log("measureDiv", measureDiv);
		
		const rect = measureDiv.getBoundingClientRect();
		const width = Math.ceil(rect.width);
		const height = Math.ceil(rect.height);
		
		document.body.removeChild(measureDiv);
		
		// Set up SVG dimensions - no additional padding needed since CSS padding is already applied
		const svgWidth = width;
		const svgHeight = height;
		
		svg.setAttribute("width", svgWidth);
		svg.setAttribute("height", svgHeight);
		svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		
		foreignObject.setAttribute("width", svgWidth);
		foreignObject.setAttribute("height", svgHeight);
		foreignObject.appendChild(div);
		svg.appendChild(foreignObject);

		// Convert SVG to Blob
		const svgMarkup = new XMLSerializer().serializeToString(svg);
		const svgFile = new Blob([svgMarkup], { type: "image/svg+xml" });

		const img = new Image();
		img.src = URL.createObjectURL(svgFile);
		await img.decode();
		URL.revokeObjectURL(img.src);
		
		// Create canvas
		const dpr = window.devicePixelRatio || 1;
		const canvas = document.createElement("canvas");
		canvas.width = svgWidth * dpr;
		canvas.height = svgHeight * dpr;
		canvas.style.width = `${svgWidth}px`;
		canvas.style.height = `${svgHeight}px`;
		
		const ctx = canvas.getContext("2d");
		ctx.scale(dpr, dpr);
		ctx.imageSmoothingEnabled = false;
		
		// Draw SVG to canvas
		ctx.drawImage(img, 0, 0);
		
		// Get the actual bounding box of the rendered content
		const boundingBox = this._getDerivedBoundingBox(canvas);
		
		return { canvas, boundingBox };
	}



	/**
	 * Update the stimulus, if necessary.
	 *
	 * @name module:visual.TextStim#_updateIfNeeded
	 * @protected
	 */
	_updateIfNeeded()
	{
		if (!this._needUpdate)
		{
			return;
		}
		this._needUpdate = false;

		// update the PIXI representation, if need be:
		if (this._needPixiUpdate)
		{
			this._needPixiUpdate = false;

			if (typeof this._pixi !== "undefined")
			{
		     this._pixi.destroy(true);
			}

			console.log("!. this._renderMethod", this._renderMethod);
			if (this._renderMethod == 2) {
				// Use SVG-to-image rendering method, in order to support variable fonts (ie not limited by Canvas 2D API)
				this._createSVGTextImage().then(({ canvas, boundingBox }) => {
					const baseTexture = new PIXI.BaseTexture(canvas);
					const texture = new PIXI.Texture(baseTexture);
					console.log("!. texture", texture);
					this._pixi = PIXI.Sprite.from(texture);
					console.log("!. Sprite this._pixi", this._pixi);
					
					// NOTE this gets overwritten when _applyStandardTransforms called
					if (boundingBox) {
						const actualWidth = boundingBox.bottomRight.x - boundingBox.topLeft.x + 1;
						const actualHeight = boundingBox.bottomRight.y - boundingBox.topLeft.y + 1;
						const dpr = window.devicePixelRatio || 1;
						const dim = [actualWidth / dpr, actualHeight / dpr];
						// // Update bounding box based on actual content size
						const anchor = this._getAnchor();
						this._boundingBox = new PIXI.Rectangle(
							this._pos[0] - anchor[0] * dim[0],
							this._pos[1] - dim[1] + anchor[1] * dim[1],
							dim[0],
							dim[1],
						);
					}
					
					// Apply standard transforms after async creation
					this._applyStandardTransforms();
				}).catch(error => {
					console.eror("Failed to create SVG text image:", error);
					throw error;
				});
				return; // Exit early since we're handling async creation
			} else {
				// Use existing PIXI text rendering method
				this._createPixiText();
				this._applyStandardTransforms();
			}
		}

	}

	/**
	 * Create PIXI text object using the standard method.
	 *
	 * @name module:visual.TextStim#_createPixiText
	 * @protected
	 */
	_createPixiText()
	{
		this._pixi = new PIXI.Text(this._text, this._getTextStyle());
	}

	/**
	 * Apply standard transformations to the PIXI object.
	 *
	 * @name module:visual.TextStim#_applyStandardTransforms
	 * @protected
	 */
	_applyStandardTransforms()
	{
		if (!this._pixi) return;

		const anchor = this._getAnchor();
		[this._pixi.anchor.x, this._pixi.anchor.y] = anchor;

		this._pixi.scale.x = this._flipHoriz ? -1 : 1;
		this._pixi.scale.y = this._flipVert ? 1 : -1;

		this._pixi.rotation = -this._ori * Math.PI / 180;
		this._pixi.position = to_pixiPoint(this.pos, this.units, this.win);

		this._pixi.alpha = this._opacity;
		this._pixi.zIndex = this._depth;

		// apply the clip mask:
		this._pixi.mask = this._clipMask;

		// update the size attribute:
		this._size = util.to_unit(
			[Math.abs(this._pixi.width), Math.abs(this._pixi.height)],
			"pix",
			this._win,
			this._units
		);

		// refine the estimate of the bounding box:
		this._boundingBox = new PIXI.Rectangle(
			this._pos[0] - anchor[0] * this._size[0],
			this._pos[1] - this._size[1] + anchor[1] * this._size[1],
			this._size[0],
			this._size[1],
		);
	}

	/**
	 * Convert the alignment attributes into an anchor.
	 *
	 * @name module:visual.TextStim#_getAnchor
	 * @protected
	 * @return {number[]} - the anchor
	 */
	_getAnchor()
	{
		let anchor = [];

		switch (this._alignHoriz)
		{
			case "left":
				anchor.push(0);
				break;
			case "right":
				anchor.push(1);
				break;
			default:
			case "center":
				anchor.push(0.5);
		}
		switch (this._alignVert)
		{
			case "top":
				anchor.push(0);
				break;
			case "bottom":
				anchor.push(1);
				break;
			default:
			case "center":
				anchor.push(0.5);
		}

		return anchor;
	}

  scaleToHeightPx(h, characterSetHeight) {
    this.setHeight(h*characterSetHeight);
	}

	scaleToWidthPx(h, w)
	{
		this.setHeight(h);
		const measured = this.getBoundingBox(true).width;
		const s = h / measured;
		this.setHeight(s * w);

		/* Alg of same name, by Gus. I belive they both work.
			scaleToWidthPx(w)
			{
				const bb = this.getBoundingBox(true)
				const hToW = bb.height / bb.width
				const nominalHeight = hToW * w
				this.scaleToHeightPx(nominalHeight)
			}
		*/
	}
	getText(){
    if (!this._medialShape) return this._text;
    // NOTE joining this._text only between '\u200d' only shapes to connect form
    //      on a single side, if alignHoriz !== "left". Adding \u200F 
    //      (right-to-left mark) is required
    //      (in this context, but not in HTML text, afaik) to correctly get medial
    //      form. See https://bugzilla.mozilla.org/show_bug.cgi?id=1108179
    const medialText = this._alignHoriz !== "left" ? 
      `\u200F\u200d${this._text}\u200d\u200F`:
      `\u200d${this._text}\u200d`; 
    return medialText;
	}
	_getFontURL()
	{
		if (!this._psychoJS?.serverManager?._resources) {
			return null;
		}

		// Search for font in ServerManager resources
		for (const [name, resourceData] of this._psychoJS.serverManager._resources) {
			const fontName = name.replace(/\.[^.]+$/, ''); // Remove extension
			if (fontName === this._font || name === this._font) {
				return resourceData.path;
			}
		}
		return null;
	}
}

/**
 * <p>This map associates units to default letter height.</p>
 *
 * @name module:visual.TextStim#_defaultLetterHeightMap
 * @readonly
 * @private
 */
TextStim._defaultLetterHeightMap = new Map([
	["cm", 1.0],
	["deg", 1.0],
	["degs", 1.0],
	["degFlatPos", 1.0],
	["degFlat", 1.0],
	["norm", 0.1],
	["height", 0.2],
	["pix", 20],
	["pixels", 20],
]);

/**
 * <p>This map associates units to default wrap width.</p>
 *
 * @name module:visual.TextStim#_defaultLetterHeightMap
 * @readonly
 * @private
 */
TextStim._defaultWrapWidthMap = new Map([
	["cm", 15.0],
	["deg", 15.0],
	["degs", 15.0],
	["degFlatPos", 15.0],
	["degFlat", 15.0],
	["norm", 1],
	["height", 1],
	["pix", 500],
	["pixels", 500],
]);
