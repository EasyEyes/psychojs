/**
 * Graphic User Interface
 *
 * @author Alain Pitiot
 * @author Sijia Zhao - fine-grained resource loading
 * @version 2021.2.0
 * @copyright (c) 2017-2020 Ilixa Ltd. (http://ilixa.com) (c) 2020-2021 Open Science Tools Ltd. (https://opensciencetools.org)
 * @license Distributed under the terms of the MIT License
 */

import * as Tone from "tone";
import { ExperimentHandler } from "../data/ExperimentHandler.js";
import { Clock } from "../util/Clock.js";
import { Scheduler } from "../util/Scheduler.js";
import * as util from "../util/Util.js";
import { PsychoJS } from "./PsychoJS.js";
import { ServerManager } from "./ServerManager.js";

/**
 * @class
 * Graphic User Interface
 *
 * @name module:core.GUI
 * @class
 * @param {module:core.PsychoJS} psychoJS the PsychoJS instance
 */
export class GUI
{
	get dialogComponent()
	{
		return this._dialogComponent;
	}

	constructor(psychoJS)
	{
		this._psychoJS = psychoJS;

		// gui listens to RESOURCE events from the server manager:
		psychoJS.serverManager.on(ServerManager.Event.RESOURCE, (signal) =>
		{
			this._onResourceEvents(signal);
		});

		this._dialogScalingFactor = 0;
	}

	/**
	 * <p>Create a dialog box that (a) enables the participant to set some
	 * experimental values (e.g. the session name), (b) shows progress of resource
	 * download, and (c) enables the participant to cancel the experiment.</p>
	 *
	 * <b>Setting experiment values</b>
	 * <p>DlgFromDict displays an input field for all values in the dictionary.
	 * It is possible to specify default values e.g.:</p>
	 * <code>let expName = 'stroop';<br>
	 * let expInfo = {'participant':'', 'session':'01'};<br>
	 * psychoJS.schedule(psychoJS.gui.DlgFromDict({dictionary: expInfo, title: expName}));</code>
	 * <p>If the participant cancels (by pressing Cancel or by closing the dialog box), then
	 * the dictionary remains unchanged.</p>
	 *
	 * @name module:core.GUI#DlgFromDict
	 * @function
	 * @public
	 * @param {Object} options
	 * @param {String} [options.logoUrl] - Url of the experiment logo
	 * @param {String} [options.text] - information text
	 * @param {Object} options.dictionary - associative array of values for the participant to set
	 * @param {String} options.title - name of the project
	 */
	DlgFromDict({
		logoUrl,
		text,
		dictionary,
		title,
		participantText = "Participant",
		sessionText = "Session",
		cancelText = "Cancel",
		okText = "OK",
	})
	{
		// get info from URL:
		const infoFromUrl = util.getUrlParameters();

		this._progressMsg = "&nbsp;";
		this._progressBarMax = 0;
		this._allResourcesDownloaded = false;
		this._requiredKeys = [];
		this._setRequiredKeys = new Map();

		// prepare PsychoJS component:
		this._dialogComponent = {};
		this._dialogComponent.status = PsychoJS.Status.NOT_STARTED;
		const dialogClock = new Clock();
		const self = this;

		return () =>
		{
			const t = dialogClock.getTime();

			if (t >= 0.0 && self._dialogComponent.status === PsychoJS.Status.NOT_STARTED)
			{
				self._dialogComponent.tStart = t;
				self._dialogComponent.status = PsychoJS.Status.STARTED;

				// if the experiment is licensed, and running on the license rather than on credit,
				// we use the license logo:
				if (
					self._psychoJS.getEnvironment() === ExperimentHandler.Environment.SERVER
					&& typeof self._psychoJS.config.experiment.license !== "undefined"
					&& self._psychoJS.config.experiment.runMode === "LICENSE"
					&& typeof self._psychoJS.config.experiment.license.institutionLogo !== "undefined"
				)
				{
					logoUrl = self._psychoJS.config.experiment.license.institutionLogo;
				}

				// prepare jquery UI dialog box:
				// let htmlCode = '<div id="expDialog" title="' + title + '">';
				let htmlCode = `<div id="expDialog" title="${title}">`;

				// uncomment for older version of the library:
				// htmlCode += '<p style="font-size: 0.8em; padding: 0.5em; margin-bottom: 0.5em; color: #FFAA00; border: 1px solid #FFAA00;">&#9888; This experiment uses a deprecated version of the PsychoJS library. Consider updating to a newer version (e.g. by updating PsychoPy and re-exporting the experiment).</p>'+

				// logo:
				if (typeof logoUrl === "string")
				{
					htmlCode += '<img id="dialog-logo" class="logo" alt="logo" src="' + logoUrl + '">';
				}

				// information text:
				if (typeof text === "string" && text.length > 0)
				{
					htmlCode += "<p>" + text + "</p>";
				}

				// add a combobox or text areas for each entry in the dictionary:

				// These may include Symbols as opposed to when using a for...in loop,
				// but only strings are allowed in PsychoPy
				Object.keys(dictionary).forEach((key, keyIdx) =>
				{
					const value = dictionary[key];
					const keyId = "form-input-" + keyIdx;

					// only create an input if the key is not in the URL:
					let inUrl = false;
					const cleanedDictKey = key.trim().toLowerCase();
					infoFromUrl.forEach((urlValue, urlKey) =>
					{
						const cleanedUrlKey = urlKey.trim().toLowerCase();
						if (cleanedUrlKey === cleanedDictKey)
						{
							inUrl = true;
							// break;
						}
					});

					if (!inUrl)
					{
						htmlCode += '<label for="' + keyId + '">' + getItemName(key, participantText, sessionText) + "</label>";

						// if the field is required:
						if (key.slice(-1) === "*")
						{
							self._requiredKeys.push(keyId);
						}

						// if value is an array, we create a select drop-down menu:
						if (Array.isArray(value))
						{
							htmlCode += '<select name="' + key + '" id="' + keyId + '" class="text ui-widget-content'
								+ ' ui-corner-all">';

							// if the field is required, we add an empty option and select it:
							if (key.slice(-1) === "*")
							{
								htmlCode += "<option disabled selected>...</option>";
							}

							for (const option of value)
							{
								htmlCode += "<option>" + option + "</option>";
							}

							htmlCode += "</select>";
							jQuery("#" + keyId).selectmenu({ classes: {} });
						}
						// otherwise we use a single string input:
						/*if (typeof value === 'string')*/
						else
						{
							htmlCode += '<input readonly disabled type="text" name="' + key + '" id="' + keyId;
							htmlCode += '" value="' + value + '" class="text ui-widget-content ui-corner-all">';
						}
					}
				});

				// if (this._requiredKeys.length > 0)
				// {
				// 	htmlCode += '<p class="validateTips">Fields marked with an asterisk (*) are required.</p>';
				// }

				// add a progress bar:
				htmlCode += '<hr><div id="progressMsg" class="progress">' + self._progressMsg + "</div>";
				htmlCode += '<div id="progressbar"></div></div>';

				// replace root by the html code:
				const dialogElement = document.getElementById("root");
				dialogElement.innerHTML = htmlCode;

				// setup change event handlers for all required keys:
				this._requiredKeys.forEach((keyId) =>
				{
					const input = document.getElementById(keyId);
					if (input)
					{
						input.oninput = (event) => GUI._onKeyChange(self, event);
					}
				});

				// Tackle browser demands on having user action initiate audio context
				Tone.start();

				const onOkClicked = () =>
				{
					// update dictionary:
					Object.keys(dictionary).forEach((key, keyIdx) =>
					{
						const input = document.getElementById("form-input-" + keyIdx);
						if (input)
						{
							dictionary[key] = input.value;
						}
					});

					self._dialogComponent.button = "OK";
					jQuery("#expDialog").dialog("close");

					// switch to full screen if requested:
					self._psychoJS.window.adjustScreenSize();

					// Clear events (and keypresses) accumulated during the dialog
					self._psychoJS.eventManager.clearEvents();
				}

				// init and open the dialog box:
				self._dialogComponent.button = "Cancel";
				jQuery("#expDialog").dialog({
					width: "500",

					autoOpen: true,
					modal: false,
					closeOnEscape: false,
					resizable: false,
					draggable: false,

					buttons: [
						{
							id: "buttonCancel",
							text: cancelText,
							click: function()
							{
								self._dialogComponent.button = "Cancel";
								jQuery("#expDialog").dialog("close");
							},
						},
						{
							id: "buttonOk",
							text: okText,
							click: onOkClicked,
						},
					],

					// close is called by both buttons and when the user clicks on the cross:
					close: function()
					{
						// jQuery.unblockUI();
						jQuery(this).dialog("destroy").remove();
						self._dialogComponent.status = PsychoJS.Status.FINISHED;
					},
				})
					// change colour of title bar
					.prev(".ui-dialog-titlebar").css("background", "green");

				// update the OK button status:
				self._updateOkButtonStatus();

				// block UI until user has pressed dialog button:
				// note: block UI does not allow for text to be entered in the dialog form boxes, alas!
				// jQuery.blockUI({ message: "", baseZ: 1});

				// show dialog box:
				jQuery("#progressbar").progressbar({ value: self._progressBarCurrentValue });
				jQuery("#progressbar").progressbar("option", "max", self._progressBarMax);
			}

			if (self._dialogComponent.status === PsychoJS.Status.FINISHED)
			{
				return Scheduler.Event.NEXT;
			}
			else
			{
				return Scheduler.Event.FLIP_REPEAT;
			}
		};
	}

	_removeWelcomeDialogBox()
	{
		jQuery("#expDialog").dialog("destroy").remove();
	}

	/**
	 * @callback GUI.onOK
	 */
	/**
	 * Show a message to the participant in a dialog box.
	 *
	 * <p>This function can be used to display both warning and error messages.</p>
	 *
	 * @name module:core.GUI#dialog
	 * @function
	 * @public
	 * @param {Object} options
	 * @param {string} options.message - the message to be displayed
	 * @param {Object.<string, *>} options.error - an exception
	 * @param {string} options.warning - a warning message
	 * @param {boolean} [options.showOK=true] - specifies whether to show the OK button
	 * @param {GUI.onOK} [options.onOK] - function called when the participant presses the OK button
	 */
	dialog({
		message,
		warning,
		error,
		showOK = true,
		onOK,
		okText = "OK",
	} = {})
	{
		// close the previously opened dialog box, if there is one:
		this.closeDialog();

		let htmlCode;
		let titleColour;

		// we are displaying an error:
		if (typeof error !== "undefined")
		{
			this._psychoJS.logger.fatal(util.toString(error));

			// let extraMessageFromEasyEyes = "";
			// if (window.errorHandler)
			// {
			// 	extraMessageFromEasyEyes = window.errorHandler(error);
			// }

			// deal with null error:
			if (!error)
			{
				error = "Unspecified JavaScript error";
			}

			let errorCode = null;

			// go through the error stack and look for errorCode if there is one:
			let stackCode = "<ul>";
			while (true)
			{
				if (typeof error === "object" && "errorCode" in error)
				{
					errorCode = error.errorCode;
				}

				if (typeof error === "object" && "context" in error)
				{
					stackCode += "<li>" + error.context + "</li>";
					error = error.error;
				}
				else
				{
					// limit the size of the error:
					if (error.length >= 1000)
					{
						error = error.substring(1, 1000);
					}

					stackCode += "<li><b>" + error + "</b></li>";
					break;
				}
			}
			stackCode += "</ul>";

			// if we found an errorCode, we replace the stack-based message by a more user-friendly one:
			if (errorCode)
			{
				const error = this._userFriendlyError(errorCode);
				htmlCode = error.htmlCode;
				titleColour = error.titleColour;
			}
			else
			{
				htmlCode = '<div id="msgDialog" title="Error">';
				htmlCode += '<p class="validateTips">Unfortunately we encountered the following error:</p>';
				htmlCode += stackCode;
				htmlCode += `<p class="psychojs-alert-text">Click the REPORT button to report the error to the EasyEyes team. We will try to fix it. Thank you for your help.</p>`;
				htmlCode += "</div>";

				titleColour = "red";
			}

			// if (extraMessageFromEasyEyes.length)
			// {
			// 	htmlCode += `<p>${extraMessageFromEasyEyes}</p>`;
			// }
		}
		// we are displaying a message:
		else if (typeof message !== "undefined")
		{
			htmlCode = '<div id="msgDialog" title="EasyEyes">'
				+ '<p class="validateTips">' + message + "</p>"
				+ "</div>";
			titleColour = "green";
		}
		// we are displaying a warning:
		else if (typeof warning !== "undefined")
		{
			htmlCode = '<div id="msgDialog" title="Warning">'
				+ '<p class="validateTips">' + warning + "</p>"
				+ "</div>";
			titleColour = "orange";
		}

		// replace root by the html code:
		const dialogElement = document.getElementById("root");
		dialogElement.innerHTML = htmlCode;

		// init and open the dialog box:
		const self = this;
		jQuery("#msgDialog").dialog({
			// dialogClass: "no-close", //uncomment to prevent the user from closing the dialog box
			// closeText:"X", // this is not working for some reason so we're manually changing the close button text a bit further down
			
			width: "500",

			autoOpen: true,
			modal: false,
			closeOnEscape: false,
			resizable: false,
			draggable: false,

			buttons: (!showOK) ? [] : [{
				id: "buttonOk",
				text: okText,
				click: function()
				{
					jQuery(this).dialog("destroy").remove();

					// execute callback function:
					if (typeof onOK !== "undefined")
					{
						onOK();
					}
				},
			}],
		})
			// change colour of title bar
			.prev(".ui-dialog-titlebar").css("background", titleColour);
			const dialogCloseButton = document.getElementsByClassName("ui-dialog-titlebar-close")[0];
			if (dialogCloseButton){
				dialogCloseButton.innerHTML = "X";
			}
			
	}

	/**
 * Show a message to the participant directly in the main window.
 *
 * <p>This function can be used to display both warning and error messages.</p>
 *
 * @name module:core.GUI#displayMessage
 * @function
 * @public
 * @param {Object} options
 * @param {string} options.message - the message to be displayed
 * @param {Object.<string, *>} options.error - an exception
 * @param {string} options.warning - a warning message
 * @param {string} [options.okUrl] - the URL to redirect 
 */
displayMessage({
    message,
    warning,
    error,
	okUrl,
	isCompleted,
	okText
} = {}) {
    let htmlCode;
    let titleColor;

    // Determine the type of message and set the HTML content and color accordingly
    if (error) {
        if (!error) {
            error = "Unspecified JavaScript error";
        }
        htmlCode = `<div id="msgDisplay" class="error"><p>${error}</p></div>`;
        titleColor = "black";
    } else if (message) {
		if (isCompleted && okUrl !== undefined){
			htmlCode = `<div id="msgDisplay" class="message">${message}</div>`;
		} else {
			htmlCode = `<div id="msgDisplay" class="message"><p>${message}</p></div>`;
		}
        
        titleColor = "black";
    } else if (warning) {
        htmlCode = `<div id="msgDisplay" class="warning"><p>${warning}</p></div>`;
        titleColor = "black";
    }
	let displayElement; 
	if (document.getElementById("exp-end-text") == null){
    displayElement = document.createElement('div');} else {
	displayElement = document.getElementById("exp-end-text");
	}
    displayElement.innerHTML = htmlCode;

    // Optionally, apply CSS styles to the message display
    displayElement.style.color = titleColor;
    displayElement.style.textAlign = 'center';
	displayElement.style.lineHeight = "1.5";
	displayElement.style.paddingTop = "40vh";
	displayElement.style.paddingBottom = "30vh";
	displayElement.style.display = "flex";
	displayElement.style.flexDirection = "column";
	displayElement.style.alignItems = "center";
    // displayElement.style.padding = '20px';
	displayElement.id  = "exp-end-text";
	displayElement.style.visibility = "visible";
	//make font bigger
	displayElement.style.fontSize = "24px";
	//background color of body should be white
	document.body.style.backgroundColor = "white";
	document.body.appendChild(displayElement);

	if(isCompleted && okUrl !== undefined){
	// If an OK URL is provided, redirect the participant to that URL
	const button = document.createElement('button');
	button.innerHTML = "OK";
	button.style.zIndex = "100";
	button.classList.add("form-input-btn");
	button.addEventListener('click', () => {
			window.location = okUrl;	
	});
	displayElement.appendChild(button);

}

}

// You might need to add CSS styles for classes `error`, `message`, and `warning` if not already defined


	/**
	 * Close the previously opened dialog box, if there is one.
	 *
	 * @name module:core.GUI#closeDialog
	 * @function
	 * @public
	 */
	closeDialog()
	{
		const expDialog = jQuery("#expDialog");
		if (expDialog.length)
		{
			expDialog.dialog("destroy").remove();
		}
		const msgDialog = jQuery("#msgDialog");
		if (msgDialog.length)
		{
			msgDialog.dialog("destroy").remove();
		}
	}

	/**
	 * Listener for resource event from the [Server Manager]{@link ServerManager}.
	 *
	 * @name module:core.GUI#_onResourceEvents
	 * @function
	 * @private
	 * @param {Object.<string, string|Symbol>} signal the signal
	 */
	_onResourceEvents(signal)
	{
		this._psychoJS.logger.debug("signal: " + util.toString(signal));

		// the download of the specified resources has started:
		if (signal.message === ServerManager.Event.DOWNLOADING_RESOURCES)
		{
			// for each resource, we have a 'downloading resource' and a 'resource downloaded' message:
			this._progressBarMax = signal.count * 2;
			jQuery("#progressbar").progressbar("option", "max", this._progressBarMax);

			this._progressBarCurrentValue = 0;
		}
		// all the resources have been downloaded: show the ok button
		else if (signal.message === ServerManager.Event.DOWNLOAD_COMPLETED)
		{
			this._allResourcesDownloaded = true;
			jQuery("#progressMsg").text("All resources downloaded.");
			this._updateOkButtonStatus();
		}
		// update progress bar:
		else if (
			signal.message === ServerManager.Event.DOWNLOADING_RESOURCE
			|| signal.message === ServerManager.Event.RESOURCE_DOWNLOADED
		)
		{
			if (typeof this._progressBarCurrentValue === "undefined")
			{
				this._progressBarCurrentValue = 0;
			}
			++this._progressBarCurrentValue;

			if (signal.message === ServerManager.Event.RESOURCE_DOWNLOADED)
			{
				jQuery("#progressMsg").text("Downloaded " + (this._progressBarCurrentValue / 2) + " / " + (this._progressBarMax / 2));
			}
			else
			{
				jQuery("#progressMsg").text("Downloading " + (this._progressBarCurrentValue / 2) + " / " + (this._progressBarMax / 2));
			}
			// $("#progressMsg").text(signal.resource + ': downloaded.');
			jQuery("#progressbar").progressbar("option", "value", this._progressBarCurrentValue);
		}
		// unknown message: we just display it
		else
		{
			jQuery("#progressMsg").text(signal.message);
		}
	}

	/**
	 * Update the status of the OK button.
	 *
	 * @name module:core.GUI#_updateOkButtonStatus
	 * @param [changeFocus = false] - whether or not to change the focus to the OK button
	 * @function
	 * @private
	 */
	_updateOkButtonStatus(changeFocus = true)
	{
		if (
			(this._psychoJS.getEnvironment() === ExperimentHandler.Environment.LOCAL)
			|| (this._allResourcesDownloaded && this._setRequiredKeys && this._setRequiredKeys.size >= this._requiredKeys.length)
		)
		{
			if (changeFocus)
			{
				jQuery("#buttonOk").button("option", "disabled", false).focus();
			}
			else
			{
				jQuery("#buttonOk").button("option", "disabled", false);
			}
		}
		else
		{
			jQuery("#buttonOk").button("option", "disabled", true);
		}

		// strangely, changing the disabled option sometimes fails to update the ui,
		// so we need to hide it and show it again:
		jQuery("#buttonOk").hide(0, () =>
		{
			jQuery("#buttonOk").show();
		});
	}

	/**
	 * Listener for change event for required keys.
	 *
	 * @name module:core.GUI#_onKeyChange
	 * @function
	 * @static
	 * @private
	 * @param {module:core.GUI} gui - this GUI
	 * @param {Event} event - event
	 */
	static _onKeyChange(gui, event)
	{
		const element = event.target;
		const value = element.value;

		if (typeof value !== "undefined" && value.length > 0)
		{
			gui._setRequiredKeys.set(event.target, true);
		}
		else
		{
			gui._setRequiredKeys.delete(event.target);
		}

		gui._updateOkButtonStatus(false);
	}

	/**
	 * Get a more user-friendly html message.
	 *
	 * @param {number} errorCode - the pavlovia.org server error code
	 * @private
	 * @return {{htmlCode: string, titleColour: string}} a user-friendly error message
	 */
	_userFriendlyError(errorCode)
	{
		switch (errorCode)
		{
			// INTERNAL_ERROR
			case 1:
				return {
					htmlCode:
						'<div id="msgDialog" title="Error"><p>Oops we encountered an internal server error.</p><p class="psychojs-alert-text">Click the REPORT button to report the error to the EasyEyes team. We will try to fix it. Thank you for your help.</p></div>',
					titleColour: "red",
				};

			// MONGODB_ERROR

			case 2:
				return {
					htmlCode:
						'<div id="msgDialog" title="Error"><p>Oops we encountered a database error.</p><p class="psychojs-alert-text">Click the REPORT button to report the error to the EasyEyes team. We will try to fix it. Thank you for your help.</p></div>',
					titleColour: "red",
				};

			// STATUS_NONE

			case 20:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> does not have any status and cannot be run.</p><p>If you are the experiment designer, go to your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a> and change the experiment status to either PILOTING or RUNNING.</p><p>Otherwise please contact the experiment designer to let him or her know that the status must be changed to RUNNING for participants to be able to run it.</p></div>`,
					titleColour: "orange",
				};

			// STATUS_INACTIVE

			case 21:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> is currently inactive and cannot be run.</p><p>If you are the experiment designer, go to your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a> and change the experiment status to either PILOTING or RUNNING.</p><p>Otherwise please contact the experiment designer to let him or her know that the status must be changed to RUNNING for participants to be able to run it.</p></div>`,
					titleColour: "orange",
				};

			// STATUS_DELETED

			case 22:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> has been deleted and cannot be run.</p><p>If you are the experiment designer, either go to your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a> and change the experiment status to either PILOTING or RUNNING, or generate a new experiment.</p><p>Otherwise please contact the experiment designer to let him or her know that the experiment has been deleted and cannot be run any longer.</p></div>`,
					titleColour: "orange",
				};

			// STATUS_ARCHIVED

			case 23:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> has been archived and cannot be run.</p><p>If you are the experiment designer, go to your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a> and change the experiment status to either PILOTING or RUNNING.</p><p>Otherwise please contact the experiment designer to let him or her know that the experiment has been archived and cannot be run at the moment.</p></div>`,
					titleColour: "orange",
				};

			// PILOTING_NO_TOKEN

			case 30:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> is currently in PILOTING mode but the pilot token is missing from the URL.</p><p>If you are the experiment designer, you can pilot it by pressing the pilot button on your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a>.</p><p>Otherwise please contact the experiment designer to let him or her know that the experiment status must be changed to RUNNING for participants to be able to run it.</p></div>`,
					titleColour: "orange",
				};

			// PILOTING_INVALID_TOKEN

			case 31:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> cannot be run because the pilot token in the URL is invalid, possibly because it has expired.</p><p>If you are the experiment designer, you can generate a new token by pressing the pilot button on your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a>.</p><p>Otherwise please contact the experiment designer to let him or her know that the experiment status must be changed to RUNNING for participants to be able to run it.</p></div>`,
					titleColour: "orange",
				};

			// LICENSE_EXPIRED

			case 50:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> is covered by a license that has expired. </p><p>If you are the experiment designer, you can either contact the license manager to inquire about the expiration, or you can run your experiments using credits. You will find all relevant details about the license on your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a>, where you will also be able to change its running mode to CREDIT.</p><p>Otherwise please contact the experiment designer to let him or her know that there is an issue with the experiment's license having expired.</p></div>`,
					titleColour: "orange",
				};

			// LICENSE_APPROVAL_NEEDED

			case 51:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> is covered by a license that requires one or more documents to be approved before the experiment can be run. </p><p>If you are the experiment designer, please contact the license manager and ask him or her which documents must be approved. You will find all relevant details about the license on your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a>.</p><p>Otherwise please contact the experiment designer to let him or her know that there is an issue with the experiment's license requiring documents to be approved.</p></div>`,
					titleColour: "orange",
				};

			// CREDIT_NOT_ENOUGH

			case 60:
				return {
					htmlCode:
						`<div id="msgDialog" title="Warning"><p><strong>${this._psychoJS.config.experiment.fullpath}</strong> does not have any assigned credit left and cannot be run.</p><p>If you are the experiment designer, you can assign more credits to it on your <a href="https://pavlovia.org/${this._psychoJS.config.experiment.fullpath}">experiment page</a>.</p><p>Otherwise please contact the experiment designer to let him or her know that the experiment requires more assigned credits to run.</p></div>`,
					titleColour: "orange",
				};

			default:
				return {
					htmlCode:
						`<div id="msgDialog" title="Error"><p>Unfortunately we encountered an unspecified error (error code: ${errorCode}.</p><p class="psychojs-alert-text">Click the REPORT button to report the error to the EasyEyes team. We will try to fix it. Thank you for your help.</p></div>`,
					titleColour: "red",
				};
		}
	}
}

/**
 * Maximal dimensions of the dialog window.
 *
 * @name module:core.GUI#dialogMaxSize
 * @enum {Symbol}
 * @readonly
 * @public
 */
GUI.dialogMaxSize = [500, 600];

/**
 * Dialog window margins.
 *
 * @name module:core.GUI#dialogMargin
 * @enum {Symbol}
 * @readonly
 * @public
 */
GUI.dialogMargin = [50, 50];


function upperFirst(s)
{
	return s[0].toUpperCase() + s.slice(1);
}

function getItemName(item, participantText, sessionText) {
	if (item === 'participant')
		return participantText
	else if (item === 'session')
		return sessionText
	else return upperFirst(item)
}
