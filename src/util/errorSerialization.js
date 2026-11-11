const isObject = value => value !== null && typeof value === "object";

const text = value => {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	return String(value);
};

const nextError = value => {
	if (isObject(value?.error)) return value.error;
	if (isObject(value?.cause)) return value.cause;
	return null;
};

/** Return the first useful message in a ServerManager/Error/cause chain. */
export const errorMessage = error => {
	const seen = new Set();
	for (let current = error, depth = 0; current && depth < 10; depth++) {
		if (!isObject(current)) return text(current) || "Unknown error";
		if (seen.has(current)) break;
		seen.add(current);
		if (text(current.message).trim()) return text(current.message);
		if (!isObject(current.error) && text(current.error).trim())
			return text(current.error);
		current = nextError(current);
	}
	return "Unknown error";
};

/** Flatten nested upload errors without discarding their diagnostic fields. */
export const serializeError = (error, stage) => {
	const result = { error: errorMessage(error) };
	if (stage) result.stage = stage;
	const seen = new Set();
	for (let current = error, depth = 0; current && depth < 10; depth++) {
		if (!isObject(current)) break;
		if (seen.has(current)) break;
		seen.add(current);
		for (const key of [
			"name",
			"origin",
			"context",
			"stage",
			"status",
			"statusText",
			"code",
			"stack",
		]) {
			if (result[key] === undefined && current[key] !== undefined)
				result[key] = current[key];
		}
		current = nextError(current);
	}
	return result;
};

/** Preserve rejection identity while making its stage and message inspectable. */
export const withErrorStage = (error, stage) => {
	const details = serializeError(error, stage);
	if (isObject(error)) {
		if (stage && !error.stage) error.stage = stage;
		if (!error.message && details.error) error.message = details.error;
		return error;
	}
	return {
		name: "Error",
		...details,
		message: details.error,
	};
};
