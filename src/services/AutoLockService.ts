/**
 * Leaving OfflineLocker for another app locks the vault behind you.
 *
 * The camera, the image picker, the document picker and the share sheet all
 * background the app on the way out, which is indistinguishable from the user
 * switching away. Those flows mark themselves here so that the trip out and
 * back does not end at the PIN screen with the half-filled form thrown away.
 */

let suppressDepth = 0;
let graceUntil = 0;
// When the outstanding suppressions began
let suppressedSince = 0;

/**
 * The longest a trip out can hold the lock off. A picker iOS declined to show
 * never returns, and without a limit that left the vault never locking again
 * for the rest of the session.
 */
const MAX_SUPPRESS_MS = 10 * 60 * 1000;

/** How long suppression lingers after a picker returns, in milliseconds. */
const RESUME_GRACE_MS = 2000;

export const suppressAutoLock = (): void => {
  if (suppressDepth === 0) suppressedSince = Date.now();
  suppressDepth += 1;
};

export const resumeAutoLock = (): void => {
  suppressDepth = Math.max(0, suppressDepth - 1);
  // The foreground AppState change lands after the picker's promise resolves,
  // so hold on a little longer rather than racing it
  graceUntil = Date.now() + RESUME_GRACE_MS;
};

export const isAutoLockSuppressed = (): boolean => {
  if (suppressDepth > 0 && Date.now() - suppressedSince > MAX_SUPPRESS_MS) {
    // Whatever was holding it has been gone far too long to still be coming back
    suppressDepth = 0;
  }
  return suppressDepth > 0 || Date.now() < graceUntil;
};

/** Runs a native flow that takes the user out of the app without locking it. */
export const withoutAutoLock = async <T>(run: () => Promise<T>): Promise<T> => {
  suppressAutoLock();
  try {
    return await run();
  } finally {
    resumeAutoLock();
  }
};
