/** @module data */
/**
 * Multiple Staircase Trial Handler
 *
 * @author Alain Pitiot
 * @version 2021.2.1
 * @copyright (c) 2017-2020 Ilixa Ltd. (http://ilixa.com) (c) 2020-2021 Open Science Tools Ltd.
 *   (https://opensciencetools.org)
 * @license Distributed under the terms of the MIT License
 */


import {TrialHandler} from "./TrialHandler.js";
import {QuestHandler} from "./QuestHandler.js";
import * as util from "../util/Util.js";
import seedrandom from "seedrandom";


/**
 * <p>A handler dealing with multiple staircases, simultaneously.</p>
 *
 * <p>Note that, at the moment, using the MultiStairHandler requires the jsQuest.js
 * library to be loaded as a resource, at the start of the experiment.</p>
 *
 * @class module.data.MultiStairHandler
 * @extends TrialHandler
 * @param {Object} options - the handler options
 * @param {module:core.PsychoJS} options.psychoJS - the PsychoJS instance
 * @param {string} options.varName - the name of the variable / intensity / contrast
 * 	/ threshold manipulated by the staircases
 * @param {module:data.MultiStairHandler.StaircaseType} [options.stairType="simple"] - the
 * 	handler type
 * @param {Array.<Object> | String} [options.conditions= [undefined] ] - if it is a string,
 * 	we treat it as the name of a conditions resource
 * @param {module:data.TrialHandler.Method} options.method - the trial method
 * @param {number} [options.nTrials=50] - maximum number of trials
 * @param {number} options.randomSeed - seed for the random number generator
 * @param {string} options.name - name of the handler
 * @param {boolean} [options.autoLog= false] - whether or not to log
 * @param {number}
 */
export class MultiStairHandler extends TrialHandler
{
	/**
	 * @constructor
	 * @public
	 */
	constructor({
		psychoJS,
		varName,
		stairType,
		conditions,
		method = TrialHandler.Method.RANDOM,
		nTrials = 50,
		randomSeed,
		name,
		autoLog,
		duplicates = 1, // aka subtrials-per-Trial
	} = {})
	{
		super({
			psychoJS,
			name,
			autoLog,
			seed: randomSeed,
			// note: multiStairHandler is a sequential TrialHandler, we deal with randomness
			// in _nextTrial
			method: TrialHandler.Method.SEQUENTIAL,
			trialList: Array(nTrials),
			nReps: 1
		});

		// now that we have initialised a sequential TrialHandler, we update method:
		this._multiMethod = method;
		this._addAttribute("varName", varName);
		this._addAttribute("stairType", stairType, MultiStairHandler.StaircaseType.SIMPLE);
		this._addAttribute("conditions", conditions, [undefined]);
		this._addAttribute("nTrials", nTrials);

		// Support grouping multiple trials into one, ie duplicating a trial into multiple
		// eg for targetKind===repeatedLetters, one scientist-specified trial becomes two trials here (one for each response)
		this._duplicates = duplicates;

		// aka which sub-trial we're on currently
		this._duplicatedTrialCardinal = 0; // Repeat this condition from value from 1 to this._duplicates

		if (typeof randomSeed !== "undefined")
		{
			this._randomNumberGenerator = seedrandom(randomSeed);
		}
		else
		{
			this._randomNumberGenerator = seedrandom();
		}

		this._prepareStaircases();
		this._nextTrial();
	}

	/**
	 * Add a response to the current staircase.
	 *
	 * @name module:data.MultiStairHandler#addResponse
	 * @function
	 * @public
	 * @param{number | number[]} response - the response to the trial, must be either 0 (incorrect or
	 * non-detected) or 1 (correct or detected), or an array of 0,1s to indicate multiple responses at this QUEST value
	 * @param{number | undefined} [value] - optional intensity / contrast / threshold
	 * @param{boolean} [doGiveToQuest = true] - whether or not to give the response to QUEST, ie
	 * 	as a response to a valid, usable trial
	 * @returns {void}
	 */
	addResponse(response, value, doGiveToQuest = true)
	{
		// check that response is either 0 or 1, or an array of only 0s and 1s:
		if (response !== 0 && response !== 1 && !(response instanceof Array && response.every(r => [0,1].includes(r))))
		{
			throw {
				origin: "MultiStairHandler.addResponse",
				context: "when adding a trial response",
				error: `the response must be either 0 or 1, got: ${JSON.stringify(response)}`
			};
		}

		if (response instanceof Array){
			response.forEach(r => this._psychoJS.experiment.addData(this._name + '.response', r));
		} else {
			this._psychoJS.experiment.addData(this._name + '.response', response);
		}

		if (!this._finished)
		{
			// update the current staircase, but do not add the response again:
			this._currentStaircase.addResponse(response, value, false, doGiveToQuest);

			// TODO Find out how to repeat bad trials
			// if (!doGiveToQuest){
				// If this was a bad trial, put back in the list of possible conditions
				// this.trialKey = util.shuffle([...this.trialKey, this._currentStaircase._name]);
			// }

			// move onto the next trial:
			this._nextTrial();
		}
	}

	/**
	 * Validate the conditions.
	 *
	 * @name module:data.MultiStairHandler#_validateConditions
	 * @function
	 * @protected
	 * @returns {void}
	 */
	_validateConditions()
	{
		try
		{
			// conditions must be a non empty array:
			if (!Array.isArray(this._conditions) || this._conditions.length === 0)
			{
				throw "conditions should be a non empty array of objects";
			}

			// TODO this is temporary until we have implemented StairHandler:
			if (this._stairType === MultiStairHandler.StaircaseType.SIMPLE)
			{
				throw "'simple' staircases are currently not supported";
			}

			for (const condition of this._conditions)
			{
				// each condition must be an object:
				if (typeof condition !== "object")
				{
					throw "one of the conditions is not an object";
				}

				// each condition must include certain fields, such as startVal and label:
				if (!("startVal" in condition))
				{
					throw "each condition should include a startVal field";
				}
				if (!("label" in condition))
				{
					throw "each condition should include a label field";
				}

				// for QUEST, we also need startValSd:
				if (this._stairType === MultiStairHandler.StaircaseType.QUEST && !("startValSd" in condition))
				{
					throw "QUEST conditions must include a startValSd field";
				}
			}
		}
		catch (error)
		{
			throw {
				origin: "MultiStairHandler._validateConditions",
				context: "when validating the conditions",
				error
			};
		}
	}

	/**
	 * Setup the staircases, according to the conditions.
	 *
	 * @name module:data.MultiStairHandler#_prepareStaircases
	 * @function
	 * @protected
	 * @returns {void}
	 */
	_prepareStaircases()
	{
		try
		{
			this._validateConditions();

			this._staircases = [];
			this.trialKey = [];

			for (const condition of this._conditions)
			{
				let handler;

				// QUEST handler:
				if (this._stairType === MultiStairHandler.StaircaseType.QUEST)
				{
					const args = Object.assign({}, condition);
					args.psychoJS = this._psychoJS;
					args.varName = this._varName;
					// label becomes name:
					args.name = condition.label;
					args.autoLog = this._autoLog;
					if (typeof condition.nTrials === "undefined")
					{
						args.nTrials = this._nTrials;
					}
					if (
						!args.hasOwnProperty("_duplicatedConditionCardinal") ||
						args._duplicatedConditionCardinal === 1
					) this.trialKey.push(...Array(args.nTrials).fill(args.name));

					handler = new QuestHandler(args);
				}

				// simple StairCase handler:
				if (this._stairType === MultiStairHandler.StaircaseType.SIMPLE)
				{
					// TODO not supported just yet, an exception is raised in _validateConditions
					continue;
				}

				this._staircases.push(handler);
			}
			this.trialKey = util.shuffle(this.trialKey);
			this.trialKey = util.repeatEveryElement(this.trialKey, this._duplicates);

			this._currentPass = [];
			this._currentStaircase = null;
		}
		catch (error)
		{
			throw {
				origin: "MultiStairHandler._prepareStaircases",
				context: "when preparing the staircases",
				error
			};
		}
	}

	/**
	 * Move onto the next trial.
	 *
	 * @name module:data.MultiStairHandler#_nextTrial
	 * @function
	 * @protected
	 * @returns {void}
	 */
	_nextTrial()
	{
		try
		{
			// if the current pass is empty, get a new one:
			if (this._currentPass.length === 0)
			{
				this._currentPass = this._staircases.filter( handler => !handler.finished );

				if (this._multiMethod === TrialHandler.Method.SEQUENTIAL)
				{
					// nothing to do
				}
				else if (this._multiMethod === TrialHandler.Method.RANDOM)
				{
					this._currentPass = util.shuffle(this._currentPass, this._randomNumberGenerator);
				}
				else if (this._multiMethod === TrialHandler.Method.FULL_RANDOM)
				{
					if (this._currentPass.length > 0)
					{
						// select a handler at random:
						// const index = Math.floor(this._randomNumberGenerator() * this._currentPass.length);
						// const handler = this._currentPass[index];
						// this._currentPass = [handler];

						this._duplicatedTrialCardinal = (this._duplicatedTrialCardinal % this._duplicates) + 1;
						const nextConditionName = this.trialKey.shift();
						let handler;
						if (this._staircases.every(s => s.hasOwnProperty("_duplicatedConditionCardinal"))){
							handler = this._staircases.filter(staircase => staircase._name === nextConditionName && staircase._duplicatedConditionCardinal === this._duplicatedTrialCardinal)[0];
						} else {
							handler = this._staircases.filter(staircase => staircase._name === nextConditionName)[0];
						}
						this._currentPass = [handler];
					}
				}
			}


			// pick the next staircase in the pass:
			this._currentStaircase = this._currentPass.shift();


			// test for termination:
			if (typeof this._currentStaircase === "undefined")
			{
				this._finished = true;

				// update the snapshots associated with the current trial in the trial list:
				for (let t = 0; t < this._snapshots.length - 1; ++t)
				{
					// the current trial is the last defined one:
					if (typeof this._trialList[t + 1] === "undefined")
					{
						this._snapshots[t].finished = true;
						break;
					}
				}

				return;
			}


			// get the value, based on the type of the trial handler:
			let value = Number.MIN_VALUE;
			if (this._currentStaircase instanceof QuestHandler)
			{
				value = this._currentStaircase.getQuestValue();
			}
			// TODO add a test for simple staircase:
			// if (this._currentStaircase instanceof StaircaseHandler)
			// {
			// value = this._currentStaircase.getStairValue();
			// }


			this._psychoJS.logger.debug(`selected staircase: ${this._currentStaircase.name}, estimated value for variable ${this._varName}: ${value}`);


			// update the next undefined trial in the trial list, and the associated snapshot:
			for (let t = 0; t < this._trialList.length; ++t)
			{
				if (typeof this._trialList[t] === "undefined")
				{
					this._trialList[t] = {
						[this._name+"."+this._varName]: value,
						[this._name+".intensity"]: value
					};
					for (const attribute of this._currentStaircase._userAttributes)
					{
						// "name" becomes "label" again:
						if (attribute === "name")
						{
							this._trialList[t][this._name+".label"] = this._currentStaircase["_name"];
						}
						else if (attribute !== "trialList" && attribute !== "extraInfo")
						{
							this._trialList[t][this._name+"."+attribute] = this._currentStaircase["_" + attribute];
						}
					}

					if (typeof this._snapshots[t] !== "undefined")
					{
						let fieldName = this._name + "." + this._varName;
						this._snapshots[t][fieldName] = value;
						this._snapshots[t].trialAttributes.push(fieldName);
						fieldName = this._name + ".intensity";
						this._snapshots[t][fieldName] = value;
						this._snapshots[t].trialAttributes.push(fieldName);

						for (const attribute of this._currentStaircase._userAttributes)
						{
							// "name" becomes "label" again:
							if (attribute === 'name')
							{
								fieldName = this._name + ".label";
								this._snapshots[t][fieldName] = this._currentStaircase["_name"];
								this._snapshots[t].trialAttributes.push(fieldName);
							}
							else if (attribute !== 'trialList' && attribute !== 'extraInfo')
							{
								fieldName = this._name+"."+attribute;
								this._snapshots[t][fieldName] = this._currentStaircase["_" + attribute];
								this._snapshots[t].trialAttributes.push(fieldName);
							}
						}
					}
					break;
				}
			}
		}
		catch (error)
		{
			throw {
				origin: "MultiStairHandler._nextTrial",
				context: "when moving onto the next trial",
				error
			};
		}
	}
}

/**
 * MultiStairHandler staircase type.
 *
 * @enum {Symbol}
 * @readonly
 * @public
 */
MultiStairHandler.StaircaseType = {
	/**
	 * Simple staircase handler.
	 */
	SIMPLE: Symbol.for("SIMPLE"),

	/**
	 * QUEST handler.
	 */
	QUEST: Symbol.for("QUEST")
};

/**
 * Staircase status.
 *
 * @enum {Symbol}
 * @readonly
 * @public
 */
MultiStairHandler.StaircaseStatus = {
	/**
	 * The staircase is currently running.
	 */
	RUNNING: Symbol.for("RUNNING"),

	/**
	 * The staircase is now finished.
	 */
	FINISHED: Symbol.for("FINISHED")
};
