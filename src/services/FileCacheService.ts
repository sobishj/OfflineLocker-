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

/**
 * Writes a data URI (or bare base64) into the decrypted cache and returns the
 * path it landed on.
 *
 * iOS renders a PDF from a file and nothing else: WKWebView will not take a
 * data URI, and the share sheet needs something on disk too. Reusing a file
 * that is already there keeps reopening the same document instant.
 */
export const writeCachedFile = async (
  dataUri: string,
  name: string,
  ext: string,
): Promise<string> => {
  const dir = await ensureDecryptedCacheDir();
  const safeName = (name || 'file').replace(/[^a-z0-9]/gi, '_').slice(0, 60) || 'file';
  const target = `${dir}${safeName}.${ext}`;

  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && existing.size && existing.size > 0) return target;

  const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  await FileSystem.writeAsStringAsync(target, base64, { encoding: 'base64' });
  return target;
};

/** A stable name for a document that has no id of its own to key off. */
export const cacheKeyForUri = (uri: string): string => {
  let hash = 0;
  const sample = uri.length > 4096 ? uri.slice(0, 2048) + uri.slice(-2048) : uri;
  for (let i = 0; i < sample.length; i++) {
    hash = (hash * 31 + sample.charCodeAt(i)) | 0;
  }
  return `u${(hash >>> 0).toString(36)}_${uri.length}`;
};
