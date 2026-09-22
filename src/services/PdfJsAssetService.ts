import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Makes pdf.js reachable from a WebView on iOS.
 *
 * Android keeps its copy in `android/app/src/main/assets/pdfjs/`, which a
 * WebView can open directly as `file:///android_asset/`. iOS has no equivalent,
 * and this app has no network to fetch a CDN copy over - pointing at one is why
 * every PDF on an iPhone came up blank. So the same two files travel inside the
 * JS bundle and are unpacked, once, into the cache directory. A page loaded
 * from that directory can then pull them in with a plain relative `src`.
 *
 * `loadHTMLString` with a `file://` base URL is not an option here: WKWebView
 * refuses to load local subresources for it. The page itself has to be a real
 * file sitting next to the scripts, which is why `writePage` exists.
 */
const PDFJS_DIR = `${FileSystem.cacheDirectory}pdfjs/`;

export const PDFJS_LIB_NAME = 'pdf.min.js';
export const PDFJS_WORKER_NAME = 'pdf.worker.min.js';

/** Android reads both straight out of the APK. */
export const ANDROID_PDFJS_DIR = 'file:///android_asset/pdfjs/';

let unpacking: Promise<string> | null = null;

const copyAsset = async (moduleRef: number, fileName: string): Promise<void> => {
  const target = `${PDFJS_DIR}${fileName}`;
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists && existing.size && existing.size > 0) return;

  const asset = Asset.fromModule(moduleRef);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error(`pdf.js asset ${fileName} has no local copy`);
  await FileSystem.copyAsync({ from: asset.localUri, to: target });
};

const unpack = async (): Promise<string> => {
  await FileSystem.makeDirectoryAsync(PDFJS_DIR, { intermediates: true }).catch(() => {});
  await copyAsset(require('../../assets/pdfjs/pdf-lib.pdfjsasset'), PDFJS_LIB_NAME);
  await copyAsset(require('../../assets/pdfjs/pdf-worker.pdfjsasset'), PDFJS_WORKER_NAME);
  return PDFJS_DIR;
};

/**
 * The directory holding `pdf.min.js` and `pdf.worker.min.js`, unpacking them
 * first if this is the first call of the session.
 */
export const ensurePdfJsDir = async (): Promise<string> => {
  if (Platform.OS === 'android') return ANDROID_PDFJS_DIR;
  if (Platform.OS === 'web') return '';

  if (!unpacking) {
    unpacking = unpack().catch(error => {
      // A failed unpack must not be cached, or every later attempt inherits it
      unpacking = null;
      throw error;
    });
  }
  return unpacking;
};

/**
 * Writes an HTML page into the pdf.js directory and returns its `file://` URL,
 * so the scripts beside it resolve and the page can read the PDF itself.
 */
export const writePdfJsPage = async (fileName: string, html: string): Promise<string> => {
  const dir = await ensurePdfJsDir();
  const target = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(target, html);
  return target;
};

/** WKWebView is only allowed to read below this, so it has to cover both the
 *  page and the decrypted PDFs, which live in sibling directories. */
export const READ_ACCESS_ROOT = FileSystem.cacheDirectory || '';
