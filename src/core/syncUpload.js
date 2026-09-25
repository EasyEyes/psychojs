/**
 * Upload results while the page is closing.
 *
 * navigator.sendBeacon is the right transport here — fire-and-forget, no
 * user gesture, transmitted after the page is gone — but browsers cap its
 * payload (roughly 32-64 kB) and refuse over-quota payloads SYNCHRONOUSLY,
 * returning false while the unload handler is still running. A refused
 * beacon means nothing was queued and nothing will ever be sent, silently
 * dropping the whole results file (field signature: every close-time-labeled
 * result file under the cap survived; every larger file lost its label).
 * On refusal — or when sendBeacon is absent or throws — fall back to a
 * synchronous XHR POST, which has no size cap and is honored inside unload
 * handlers. Synchronous main-thread XHR is discouraged, but this runs once,
 * at page death, only when the beacon could not take the payload.
 *
 * @param {string} url
 * @param {FormData} formData
 * @returns {"beacon"|"xhr"|"none"} which transport accepted the payload
 */
export const uploadWhenPageClosing = (url, formData) => {
  let queued = false;
  try {
    queued =
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(url, formData);
  } catch (_e) {
    queued = false;
  }
  if (queued) return "beacon";

  try {
    const xhr = new XMLHttpRequest();
    // Synchronous on purpose: blocks until the request is sent, so the
    // browser cannot tear the page down mid-upload.
    xhr.open("POST", url, false);
    xhr.send(formData);
    return "xhr";
  } catch (_e) {
    return "none";
  }
};
