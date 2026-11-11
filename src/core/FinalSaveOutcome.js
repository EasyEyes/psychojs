import { serializeError } from "../util/errorSerialization.js";
import { ExperimentHandler } from "../data/ExperimentHandler.js";

const nowMs = () =>
	typeof performance !== "undefined" ? performance.now() : Date.now();
const seconds = ms => Math.max(0, Math.round(ms) / 1000);

// The canonical save stages, in quit() order.
const STAGES = ["csvUpload", "logUpload", "sessionClose"];
// The serialized per-stage schema; internal fields (startedAt) never leak.
const STAGE_FIELDS = ({ status, attempts, durationSec, error }) => ({
	status,
	attempts,
	durationSec,
	error,
});

/** Cumulative, best-effort final-save audit. It never blocks experiment quit. */
export class FinalSaveOutcome {
	constructor(psychoJS) {
		this._psychoJS = psychoJS;
		this._state = { version: 1, outcomeUploadErrors: [] };
		for (const stage of STAGES) this._state[stage] = this._stage("pending");
	}

	_stage(status) {
		return { status, attempts: 0, durationSec: 0, error: null, startedAt: null };
	}

	begin(stage) {
		const current = this._state[stage];
		this._state[stage] = {
			...current,
			status: "inProgress",
			error: null,
			attempts: current.attempts + 1,
			startedAt: nowMs(),
		};
		// Pending only: the in-progress state must not be frozen into the
		// uploaded CSV (save() serializes committed rows during csvUpload).
		this._writeMainColumn(false);
	}

	async succeed(stage) {
		await this._finish(stage, "succeeded", null);
	}

	async fail(stage, error) {
		if (!this._state[stage]) return;
		await this._finish(stage, "failed", serializeError(error, stage));
	}

	async _finish(stage, status, error) {
		const current = this._state[stage];
		this._state[stage] = {
			...current,
			status,
			durationSec: seconds(nowMs() - (current.startedAt ?? nowMs())),
			error,
		};
		this._writeMainColumn(true);
		await this._upload(stage);
	}

	_json() {
		const json = {
			version: this._state.version,
			outcomeUploadErrors: this._state.outcomeUploadErrors,
		};
		for (const stage of STAGES) json[stage] = STAGE_FIELDS(this._state[stage]);
		return JSON.stringify(json);
	}

	_writeMainColumn(stampCommittedRow) {
		const experiment = this._psychoJS._experiment ?? this._psychoJS.experiment;
		const json = this._json();
		experiment?.addData?.("finalSaveOutcomeJSON", json);
		if (!stampCommittedRow) return;
		// Stamp the last COMMITTED row: the pending entry dies with the page,
		// and a rescue quit's re-save re-uploads committed rows — the field-proven
		// BoldBronze escape-rescue path. The sidecar remains the primary carrier.
		// The pending+committed stamping mirrors threshold's
		// components/attemptTelemetry.ts (snapshotAttempt); change both.
		const completed = experiment?._trialsData;
		if (Array.isArray(completed) && completed.length > 0)
			completed[completed.length - 1].finalSaveOutcomeJSON = json;
	}

	async _upload(stage) {
		const psychoJS = this._psychoJS;
		if (
			psychoJS.getEnvironment?.() !== ExperimentHandler.Environment.SERVER
		)
			return;
		if (psychoJS.config?.experiment?.status !== "RUNNING") return;
		if (psychoJS._serverMsg?.has?.("__pilotToken")) return;

		const dataFileName =
			(psychoJS._experiment ?? psychoJS.experiment)?._dataFileName || "results";
		let timeout;
		try {
			await Promise.race([
				Promise.resolve(
					psychoJS.serverManager.uploadData(
						`${dataFileName}.finalSaveOutcome.json`,
						JSON.stringify(this._state),
					),
				),
				new Promise((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("finalSaveOutcome upload timed out")),
						10_000,
					);
				}),
			]);
		} catch (error) {
			// Metadata delivery is best-effort and must never stop data saving or
			// completion. Preserve the failure locally for the next sidecar attempt.
			this._state.outcomeUploadErrors = [
				...this._state.outcomeUploadErrors,
				{ stage, message: serializeError(error).error },
			].slice(-5);
			this._writeMainColumn(true);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}
}
