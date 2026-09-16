import {
  getRetryDelayMs,
  notifyRetryAttempt,
  waitForRetryDelay,
} from "../../../preprocess/retry";

// 408/429/5xx-transient: server-side or timing blips that a retry can
// clear; permanent failures (400/403/409/501…) throw immediately.
const _RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// Per-attempt abort timeout. The old fixed 15 s aborted EVERY attempt for a
// participant whose uplink could not push the whole body in 15 s (a
// 3–4 MB results CSV URL-encodes to 5–7 MB, i.e. ≥ 3 Mbps sustained, plus
// Pavlovia's time to commit the file). The abort surfaced as a "network
// error", so the loop re-sent the same body forever: participants waited
// hours on the saving screen while the server had, in fact, already saved
// their data (Compare3Languages131, Sep 2026). fetch() exposes no upload
// progress, so the only sound stall detector is a budget proportional to
// what must be sent: base + bytes / minimum-supported-upload-rate.
export const UPLOAD_TIMEOUT_BASE_MS = 15_000;
// 20 KB/s ≈ 160 kbps: below this an upload is treated as stalled.
export const UPLOAD_MIN_BYTES_PER_SEC = 20_000;
export const UPLOAD_TIMEOUT_MAX_MS = 10 * 60_000;

export const uploadTimeoutMsFor = (bodyBytes) => {
	const bytes = Number.isFinite(bodyBytes) && bodyBytes > 0 ? bodyBytes : 0;
	return Math.min(
		UPLOAD_TIMEOUT_MAX_MS,
		UPLOAD_TIMEOUT_BASE_MS + (bytes / UPLOAD_MIN_BYTES_PER_SEC) * 1000,
	);
};

export async function _retryablePavloviaPost(url, data) {
	let attempt = 0;
	// URLSearchParams output is pure ASCII: string length == wire bytes.
	const encodedBody = new URLSearchParams(data).toString();
	const timeoutMs = uploadTimeoutMsFor(encodedBody.length);

	while (true) {
		const controller = new AbortController();
		const timerId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			let response;
			try {
				response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: encodedBody,
					signal: controller.signal,
				});
			} catch (e) {
				if (
					e instanceof TypeError ||
					(e instanceof DOMException && e.name === "AbortError")
				) {
					const delay = getRetryDelayMs(attempt++);
					console.warn(
						`_retryablePavloviaPost: ${
							e instanceof TypeError ? "network error" : `timed out after ${timeoutMs}ms (${encodedBody.length} bytes)`
						}, retrying in ${delay}ms`,
					);
					notifyRetryAttempt(attempt, {});
					await waitForRetryDelay(delay);
					continue;
				}
				throw e;
			}

			if (response.ok) return response;

			const { status } = response;

			if (_RETRYABLE_STATUSES.has(status)) {
				const retryAfterHeader = response.headers.get("Retry-After");
				const delay =
					retryAfterHeader !== null
						? parseFloat(retryAfterHeader) * 1000
						: getRetryDelayMs(attempt);
				attempt++;
				console.warn(
					`_retryablePavloviaPost: status ${status}, retrying in ${delay}ms`,
				);
				notifyRetryAttempt(attempt, { status });
				await waitForRetryDelay(delay);
				continue;
			}

			throw Object.assign(
				new Error(
					`_retryablePavloviaPost: POST failed with status ${status} ${response.statusText}`,
				),
				{ status, statusText: response.statusText },
			);
		} finally {
			clearTimeout(timerId);
		}
	}
}
