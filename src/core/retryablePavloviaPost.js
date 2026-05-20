import { getRetryDelayMs, wait } from "../../../preprocess/retry";

const _RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export async function _retryablePavloviaPost(url, data) {
	let attempt = 0;

	while (true) {
		const controller = new AbortController();
		const timerId = setTimeout(() => controller.abort(), 15_000);

		try {
			let response;
			try {
				response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(data),
					signal: controller.signal,
				});
			} catch (e) {
				if (
					e instanceof TypeError ||
					(e instanceof DOMException && e.name === "AbortError")
				) {
					const delay = getRetryDelayMs(attempt++);
					console.warn(
						`_retryablePavloviaPost: network error, retrying in ${delay}ms`,
					);
					await wait(delay);
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
				await wait(delay);
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
