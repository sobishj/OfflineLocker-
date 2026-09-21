import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * On-device text recognition. ML Kit is a native module, so it is required
 * lazily and only on iOS/Android — the web build falls back to no OCR.
 */
const loadRecognizer = (): any | null => {
  if (Platform.OS === 'web') return null;
  try {
    const mod = require('@react-native-ml-kit/text-recognition');
    return mod?.default || mod || null;
  } catch (e) {
    return null;
  }
};

export const isOcrAvailable = (): boolean => loadRecognizer() !== null;

/**
 * ML Kit needs a file path, so data URIs are written to the cache first.
 */
const ensureFileUri = async (uri: string): Promise<string> => {
  if (!uri.startsWith('data:')) return uri;
  const base64 = uri.includes(',') ? uri.split(',')[1] : uri;
  const target = `${FileSystem.cacheDirectory}ocr_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(target, base64, { encoding: 'base64' });
  return target;
};

/** Returns recognised text, or '' when OCR is unavailable or finds nothing. */
export const recognizeTextFromImage = async (uri: string): Promise<string> => {
  const recognizer = loadRecognizer();
  if (!recognizer || !uri) return '';

  try {
    const fileUri = await ensureFileUri(uri);
    const result = await recognizer.recognize(fileUri);
    if (!result) return '';
    if (typeof result.text === 'string' && result.text.trim()) return result.text;
    if (Array.isArray(result.blocks)) {
      return result.blocks.map((b: any) => b?.text || '').filter(Boolean).join('\n');
    }
    return '';
  } catch (e) {
    console.warn('OCR failed:', e);
    return '';
  }
};

const yymmddToDate = (value: string): string => {
  if (!/^\d{6}$/.test(value)) return '';
  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  // Travel documents expire within a few decades, so a low year is 20xx
  const year = yy <= 60 ? 2000 + yy : 1900 + yy;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(dd)}/${pad(mm)}/${year}`;
};

/**
 * A date of birth can never be in the future, so a century guess that lands
 * ahead of today belongs to the previous one.
 */
const yymmddToBirthDate = (value: string): string => {
  const formatted = yymmddToDate(value);
  if (!formatted) return '';
  const year = Number(formatted.slice(6));
  return year > new Date().getFullYear() ? `${formatted.slice(0, 6)}${year - 100}` : formatted;
};

/**
 * Passports and ID cards carry a machine readable zone that encodes the
 * document number and the expiry and birth dates at fixed offsets, which
 * survives OCR better than the printed labels do. The birth date is reported so callers can keep it out of
 * the validity period — on a scan the printed "Date of Birth" label is often
 * misread, but the MRZ still gives the value away.
 *
 * Line 2 layout: docNo(9) check(1) nationality(3) dob(6) check(1) sex(1) expiry(6)
 */
export const extractDatesFromMrz = (text: string): { startDate: string; endDate: string; birthDate: string; documentNumber: string } => {
  if (!text) return { startDate: '', endDate: '', birthDate: '', documentNumber: '' };

  const candidates = text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, '').toUpperCase())
    .filter(line => line.length >= 28 && line.includes('<'));

  for (const line of candidates) {
    const match = line.match(/^([A-Z0-9<]{9})(\d|<)([A-Z<]{3})(\d{6})(\d|<)([MF<])(\d{6})/);
    if (match) {
      const birthDate = yymmddToBirthDate(match[4]);
      const expiry = yymmddToDate(match[7]);
      // Positions 1-9 are the document number, padded with '<' when shorter
      const documentNumber = match[1].replace(/</g, '').trim();
      if (expiry || birthDate || documentNumber) {
        return { startDate: '', endDate: expiry, birthDate, documentNumber };
      }
    }
  }

  return { startDate: '', endDate: '', birthDate: '', documentNumber: '' };
};
