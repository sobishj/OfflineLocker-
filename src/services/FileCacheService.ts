import * as FileSystem from 'expo-file-system/legacy';

/**
 * Where decrypted files are written so the PDF viewer, OCR and the share sheet
 * can reach them. Handing a WebView a path instead of tens of megabytes of
 * base64 is the difference between a document opening at once and the app
 * locking up, but it does mean plaintext on disk for as long as it sits there.
 *
 * It is app-private storage, and everything in here is deleted the moment the
 * vault locks, so nothing decrypted outlives the unlocked session.
 */
export const DECRYPTED_CACHE_DIR = `${FileSystem.cacheDirectory}decrypted/`;

let ensured = false;

export const ensureDecryptedCacheDir = async (): Promise<string> => {
  if (!ensured) {
    try {
      await FileSystem.makeDirectoryAsync(DECRYPTED_CACHE_DIR, { intermediates: true });
    } catch (e) {
      // Already there, which is the common case
    }
    ensured = true;
  }
  return DECRYPTED_CACHE_DIR;
};

/** Removes every decrypted file. Called whenever the vault locks. */
export const clearDecryptedCache = async (): Promise<void> => {
  try {
    await FileSystem.deleteAsync(DECRYPTED_CACHE_DIR, { idempotent: true });
  } catch (e) {
    // Nothing to clear, or the directory is already gone
  }
  ensured = false;
};
