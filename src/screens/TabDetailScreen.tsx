import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator, Image, Platform, ScrollView, KeyboardAvoidingView, useWindowDimensions } from 'react-native';
import { useLockerStore } from '../store/useLockerStore';
import { AppTheme } from '../theme/AppTheme';
import ModalCloseButton from '../components/ModalCloseButton';
import { Ionicons } from '@expo/vector-icons';
import { CryptoService } from '../services/CryptoService';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImageManipulator from 'expo-image-manipulator';
import WebCamera from '../components/WebCamera';
import CustomImageCropper from '../components/CustomImageCropper';
import { WebView } from 'react-native-webview';
import PdfViewer from '../components/PdfViewer';
import ZoomableImage from '../components/ZoomableImage';
import DraggableFAB from '../components/DraggableFAB';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StorageService } from '../utils/storage';
import DatePickerModal, { parseDateString, formatDate, toDisplayDate } from '../components/DatePickerModal';
import * as Clipboard from 'expo-clipboard';
import { inflate as inflateStream } from 'pako';
import { recognizeTextFromImage, extractDatesFromMrz, isOcrAvailable } from '../services/OcrService';
import PdfRasterizer from '../components/PdfRasterizer';
import { withoutAutoLock } from '../services/AutoLockService';
import { ensureDecryptedCacheDir } from '../services/FileCacheService';
import { buildImagePdf, PdfImage } from '../services/PdfBuilder';

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const DATE_PATTERN = new RegExp(
  `\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}` +
  `|\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2}` +
  `|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*\\.?,?\\s+\\d{2,4}` +
  `|(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}`,
  'i'
);

// Explicit labels are checked before looser synonyms so a document that states
// "Start Date" wins over an incidental "from" earlier in the text.
const START_LABELS = [
  'start date', 'startdate', 'date of issue', 'issued date', 'issue date', 'issuing date', 'issued on', 'date of commencement', 'commencement date',
  'valid from', 'validfrom', 'effective from', 'effective date', 'w.e.f', 'wef', 'doi', 'from date', 'start', 'issued', 'from',
];
const END_LABELS = [
  'end date', 'enddate', 'date of expiry', 'expiry date', 'expiration date', 'expires on', 'expires by', 'exp date', 'exp',
  'valid until', 'valid till', 'valid thru', 'valid through', 'valid upto', 'valid up to', 'valid to', 'good through',
  'renewal date', 'renew by', 'due date', 'doe', 'to date', 'expiry', 'expires', 'expiration', 'end', 'until', 'till', 'upto', 'to',
];
// A date of birth is never part of a validity period. It is located first and
// then kept out of every later pass, so an ID card that prints the holder's
// birth date above the issue date cannot have it picked up as the start date.
const BIRTH_LABELS = [
  'date of birth', 'dateofbirth', 'birth date', 'birthdate', 'born on', 'born', 'dob', 'd.o.b',
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A label as it survives OCR. The space inside "valid thru" or "date of issue"
 * is whatever gap the card's layout left there, which on a scan is just as
 * often a line break as a space.
 */
const labelPattern = (label: string) => escapeRegExp(label).replace(/ /g, '\\s+');

// Guards against binary noise (e.g. inside PDF bytes) matching the date shape
const isPlausibleDate = (value: string): boolean => {
  const numeric = value.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/);
  if (numeric) {
    const parts = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
    const year = parts[0] > 31 ? parts[0] : parts[2];
    const day = parts[0] > 31 ? parts[2] : parts[0];
    const month = parts[1];
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    const fullYear = year < 100 ? 2000 + year : year;
    return fullYear >= 1900 && fullYear <= 2100;
  }
  const year = value.match(/(\d{4})\s*$/);
  if (year) {
    const y = Number(year[1]);
    return y >= 1900 && y <= 2100;
  }
  return true;
};

/**
 * Bank cards print their validity as MM/YY, which the full-date pattern does
 * not match. This is only ever read straight after a label such as "valid
 * thru", because a bare "05/28" in running text is far more likely to be
 * something else.
 */
const MONTH_YEAR = /^(0?[1-9]|1[0-2])\s*[\/\-]\s*(\d{2})(?!\d)/;

/** A card is valid from the first of its stated month and until the last day of one. */
const monthYearToDate = (month: number, twoDigitYear: number, asEnd: boolean): string => {
  const year = 2000 + twoDigitYear;
  const day = asEnd ? new Date(year, month, 0).getDate() : 1;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(day)}-${pad(month)}-${year}`;
};

const findMonthYearAfterLabel = (text: string, labels: string[], asEnd: boolean): string => {
  for (const label of labels) {
    const labelRegex = new RegExp(`(?:^|[^a-z0-9])${labelPattern(label)}[.:\\s]*`, 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = labelRegex.exec(text)) !== null) {
      const after = hit.index + hit[0].length;
      const match = text.slice(after, after + 12).match(MONTH_YEAR);
      if (match) return monthYearToDate(Number(match[1]), Number(match[2]), asEnd);
      if (labelRegex.lastIndex <= hit.index) labelRegex.lastIndex = hit.index + 1;
    }
  }
  return '';
};

/** Every date that follows any of `labels`, in the order the labels are given. */
const findDatesAfterLabels = (text: string, labels: string[]): string[] => {
  const found: string[] = [];
  for (const label of labels) {
    // Word boundaries stop "end" matching inside "extended", "to" inside "total", etc.
    const labelRegex = new RegExp(`(?:^|[^a-z0-9])${labelPattern(label)}(?![a-z0-9])`, 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = labelRegex.exec(text)) !== null) {
      const after = hit.index + hit[0].length;
      const window = text.slice(after, after + 40);
      const match = window.match(DATE_PATTERN);
      if (match && isPlausibleDate(match[0].trim())) found.push(match[0].trim());
      if (labelRegex.lastIndex <= hit.index) labelRegex.lastIndex = hit.index + 1;
    }
  }
  return found;
};

/** The first date following the highest-priority label that carries one. */
const findDateAfterLabel = (text: string, labels: string[]): string => {
  for (const label of labels) {
    const [first] = findDatesAfterLabels(text, [label]);
    if (first) return first;
  }
  return '';
};

/**
 * Birth dates found either by their printed label or in a passport's machine
 * readable zone. The MRZ matters most: on a scan the printed label is what OCR
 * mangles, while the MRZ digits survive.
 */
const findBirthDates = (text: string): string[] => {
  const { birthDate } = extractDatesFromMrz(text);
  const labelled = findDatesAfterLabels(text, BIRTH_LABELS);
  return birthDate ? [birthDate, ...labelled] : labelled;
};

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Hermes does not always provide atob, so fall back to a manual decode. */
const decodeBase64 = (input: string): string => {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  if (typeof atob === 'function') {
    try { return atob(clean); } catch (e) { /* fall through */ }
  }
  // Appending to one string a character at a time is what made a large file
  // take minutes here; the pieces are collected and joined once instead.
  const parts: string[] = [];
  let piece = '';
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64_CHARS.indexOf(clean[i]);
    const c2 = B64_CHARS.indexOf(clean[i + 1]);
    const c3 = B64_CHARS.indexOf(clean[i + 2]);
    const c4 = B64_CHARS.indexOf(clean[i + 3]);
    piece += String.fromCharCode((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) piece += String.fromCharCode(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) piece += String.fromCharCode(((c3 & 3) << 6) | c4);
    if (piece.length >= 8192) { parts.push(piece); piece = ''; }
  }
  if (piece) parts.push(piece);
  return parts.join('');
};

/**
 * What to tell the user when a save falls over. Encrypting a very large
 * attachment is the one failure with an obvious remedy, so it says so rather
 * than repeating the same flat "could not save" for everything.
 */
const saveFailureMessage = (error: any): string => {
  const reason = String(error?.message || error || '');
  if (reason.includes('ENCRYPTION_FAILED') || /memory|allocat|size|length/i.test(reason)) {
    return 'This file is too large for the vault to encrypt on this device. Try a smaller file, or split the document into separate pages.';
  }
  return 'The document could not be saved. Please try again.';
};

/** Latin-1 bytes as a string, in blocks rather than a character at a time. */
const bytesToBinaryString = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  const BLOCK = 8192;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK) as any));
  }
  return parts.join('');
};

/**
 * Past this much base64 a PDF is a scan rather than a text document: reading
 * its operators costs seconds and finds nothing, because the pages are images.
 * Those go straight to OCR of the first page instead.
 */
const PDF_TEXT_SCAN_MAX_BASE64 = 3 * 1024 * 1024;

/** A stream this large holds a picture, and inflating it only wastes time. */
const PDF_STREAM_MAX_BYTES = 512 * 1024;

/**
 * Image bytes inside a PDF happen to contain plenty of "(...)" sequences, so
 * anything that is not clean printable text is discarded — otherwise JPEG
 * noise can masquerade as a date and suppress the OCR fallback.
 */
const readTextOperators = (content: string): string =>
  (content.match(/\(((?:[^()\\]|\\.)*)\)/g) || [])
    .map(c => c.slice(1, -1).replace(/\\([()\\])/g, '$1'))
    .filter(c => /[A-Za-z0-9]/.test(c) && /^[\x20-\x7E\r\n\t]+$/.test(c))
    .join(' ');

/**
 * Pulls readable text out of a PDF, inflating FlateDecode streams so that
 * ordinary (compressed) PDFs are covered too. Scanned PDFs hold no text at
 * all — those go through OCR instead.
 */
export const extractTextFromPdfDataUri = (dataUri: string): string => {
  if (!dataUri || !dataUri.includes('application/pdf')) return '';
  try {
    const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    if (base64.length > PDF_TEXT_SCAN_MAX_BASE64) return '';
    const binary = decodeBase64(base64);

    let collected = readTextOperators(binary);

    // Inflate each stream and read the text operators inside it
    const streamRegex = /stream\r?\n?/g;
    let hit: RegExpExecArray | null;
    while ((hit = streamRegex.exec(binary)) !== null) {
      const start = hit.index + hit[0].length;
      const end = binary.indexOf('endstream', start);
      if (end === -1) continue;

      if (end - start > PDF_STREAM_MAX_BYTES) continue;

      const slice = binary.slice(start, end);
      const bytes = new Uint8Array(slice.length);
      for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i) & 0xff;

      try {
        const text = bytesToBinaryString(inflateStream(bytes));
        if (text) collected += ' ' + readTextOperators(text);
      } catch (e) {
        // Not a Flate stream (images, fonts) — nothing to read here
      }
      if (collected.length > 200000) break;
    }

    return collected.slice(0, 200000);
  } catch (e) {
    return '';
  }
};

/**
 * Looks for labelled start/end dates first, then falls back to the first two
 * loose dates found so a document that just lists two dates still populates.
 * Whichever of the pair is later always ends up as the end date.
 */
export const extractDatesFromText = (text: string): { startDate: string; endDate: string } => {
  if (!text || typeof text !== 'string') return { startDate: '', endDate: '' };

  // Compared as calendar days so the same date written two ways still matches
  const sameDay = (a: string, b: string): boolean => {
    const left = parseDateString(a);
    const right = parseDateString(b);
    return !!left && !!right && left.getTime() === right.getTime();
  };

  const birthDates = findBirthDates(text);
  const isBirthDate = (value: string) => !!value && birthDates.some(b => sameDay(b, value));

  let startDate = findDateAfterLabel(text, START_LABELS);
  let endDate = findDateAfterLabel(text, END_LABELS);
  // A loose synonym such as "from" or "to" can land on the birth date
  if (isBirthDate(startDate)) startDate = '';
  if (isBirthDate(endDate)) endDate = '';

  // Cards state MM/YY rather than a full date
  if (!startDate) startDate = findMonthYearAfterLabel(text, START_LABELS, false);
  if (!endDate) endDate = findMonthYearAfterLabel(text, END_LABELS, true);

  // ...and print the label away from the date, which the pass above needs
  if (!startDate || !endDate) {
    const card = findCardValidity(text);
    if (!startDate) startDate = card.startDate;
    if (!endDate) endDate = card.endDate;
  }

  if (!startDate || !endDate) {
    const all = text.match(new RegExp(DATE_PATTERN.source, 'gi')) || [];
    const unused = all
      .map(d => d.trim())
      .filter(d => isPlausibleDate(d) && !isBirthDate(d) && d !== startDate && d !== endDate);
    if (!startDate) startDate = unused.shift() || '';
    if (!endDate) endDate = unused.shift() || '';
  }

  const parsedStart = parseDateString(startDate);
  const parsedEnd = parseDateString(endDate);
  // A scan returns the document's own wording; normalise it so what is saved
  // and what is shown are the same DD-MM-YYYY throughout
  if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
    return { startDate: formatDate(parsedEnd), endDate: formatDate(parsedStart) };
  }

  return {
    startDate: parsedStart ? formatDate(parsedStart) : startDate,
    endDate: parsedEnd ? formatDate(parsedEnd) : endDate,
  };
};

// Labels are ordered most-specific first so "Passport No" beats a bare "No".
const NUMBER_LABELS = [
  'passport no', 'passport number', 'passport num',
  'card number', 'card no', 'account number', 'account no', 'a/c no',
  'policy number', 'policy no', 'licence number', 'license number', 'licence no', 'license no',
  'registration number', 'registration no', 'reg no',
  'document number', 'document no', 'certificate number', 'certificate no',
  'membership number', 'membership no', 'reference number', 'reference no',
  'id number', 'id no', 'serial number', 'serial no',
  'number', 'no',
];

/** Payment-card check digit, so a random 16-digit run is not mistaken for a PAN. */
const isLuhnValid = (digits: string): boolean => {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
};

const groupInFours = (digits: string) => digits.replace(/(.{4})/g, '$1 ').trim();

/** The card number inside one run of digits, spaces and hyphens. */
const panFromRun = (run: string): string => {
  const groups = run.split(/[\s-]+/).filter(Boolean);
  const all = groups.join('');
  if (isLuhnValid(all)) return groupInFours(all);

  // Only a run too long to be a card number has picked up a neighbour. A
  // 16-digit run that merely fails the check is a misread, and carving a
  // shorter "valid" number out of it would be inventing one.
  if (all.length <= 19) return '';

  for (let from = 0; from < groups.length; from++) {
    for (let to = groups.length; to > from; to--) {
      const digits = groups.slice(from, to).join('');
      if (digits.length !== all.length && isLuhnValid(digits)) return groupInFours(digits);
    }
  }
  return '';
};

/**
 * Finds a payment card number and returns it grouped in fours for readability.
 * Read a line at a time, because a card prints its number on one line and a
 * run allowed to cross line breaks swallows whatever OCR put underneath it.
 */
const findCardNumber = (text: string): string => {
  for (const line of text.split(/\r?\n/)) {
    for (const run of line.match(/\d[\d -]{11,22}\d/g) || []) {
      const found = panFromRun(run);
      if (found) return found;
    }
  }
  return '';
};

/**
 * Card faces print "VALID THRU" above or beside the MM/YY rather than in front
 * of it, and OCR returns the two in whatever order it read them. So once a
 * document looks like a card, every MM/YY on it is collected and the pair is
 * resolved by whatever cue is nearby, falling back on chronology.
 */
const MONTH_YEAR_SCAN = /(^|[^\d\/\-.])(0?[1-9]|1[0-2])\s*[\/\-]\s*(\d{2})(?![\d\/\-.])/g;

const CARD_HINTS = /valid\s*(?:thru|through|from)|good\s*(?:thru|through)|member\s*since|month\s*\/\s*year|mm\s*\/\s*yy|visa|mastercard|master\s*card|maestro|rupay|amex|american\s*express|discover|credit\s*card|debit\s*card|cvv|cvc/i;

/** Either a card's own wording or a Luhn-valid PAN is enough to treat it as one. */
const looksLikeCard = (text: string): boolean => CARD_HINTS.test(text) || !!findCardNumber(text);

// Checked against the text immediately preceding an MM/YY, end cues first so
// that the "valid" in "valid from" cannot be read as "valid thru"
const END_CUES = /(valid\s*thru|valid\s*through|valid\s*until|valid\s*till|good\s*thru|good\s*through|expires?|expiry|exp|thru|through|until|till|valid)[^a-z0-9]{0,8}$/i;
const START_CUES = /(valid\s*from|member\s*since|since|from|issued|issue|w\.?e\.?f)[^a-z0-9]{0,8}$/i;

type MonthYearHit = { month: number; year: number; cue: 'start' | 'end' | 'none' };

const findCardValidity = (text: string): { startDate: string; endDate: string } => {
  if (!looksLikeCard(text)) return { startDate: '', endDate: '' };

  const hits: MonthYearHit[] = [];
  const scan = new RegExp(MONTH_YEAR_SCAN.source, 'g');
  let hit: RegExpExecArray | null;
  while ((hit = scan.exec(text)) !== null) {
    const at = hit.index + hit[1].length;
    const before = text.slice(Math.max(0, at - 28), at);
    const cue = END_CUES.test(before) ? 'end' : START_CUES.test(before) ? 'start' : 'none';
    hits.push({ month: Number(hit[2]), year: Number(hit[3]), cue });
  }
  if (!hits.length) return { startDate: '', endDate: '' };

  let start = hits.find(h => h.cue === 'start');
  let end = hits.find(h => h.cue === 'end');

  if (!start || !end) {
    const spare = hits.filter(h => h !== start && h !== end);
    spare.sort((a, b) => a.year - b.year || a.month - b.month);
    // A card that states one date is stating when it runs out
    if (!end) end = spare.pop();
    if (!start) start = spare.shift();
  }

  return {
    startDate: start ? monthYearToDate(start.month, start.year, false) : '',
    endDate: end ? monthYearToDate(end.month, end.year, true) : '',
  };
};

/** Rejects values that are really dates, or carry no digits at all. */
const isPlausibleNumber = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length < 4 || trimmed.length > 30) return false;
  if (!/\d/.test(trimmed)) return false;
  if (parseDateString(trimmed)) return false;
  if (DATE_PATTERN.test(trimmed)) return false;
  return true;
};

const findNumberAfterLabel = (text: string, labels: string[]): string => {
  for (const label of labels) {
    const labelRegex = new RegExp(`(?:^|[^a-z0-9])${labelPattern(label)}[.:\\s#-]*`, 'gi');
    let hit: RegExpExecArray | null;
    while ((hit = labelRegex.exec(text)) !== null) {
      const after = hit.index + hit[0].length;
      // The second group exists for numbers printed in spaced groups, such as
      // a card's "4111 1111". It has to carry a digit of its own, or the word
      // after the number is swallowed too: a licence reading
      // "No.: 43/5156/2009 Date: ..." came back as "43/5156/2009 Date".
      const candidate = text.slice(after, after + 30).match(/^[A-Z0-9][A-Z0-9\/-]*(?:[ ](?=[A-Z0-9\/-]*\d)[A-Z0-9][A-Z0-9\/-]*)?/i);
      if (candidate && isPlausibleNumber(candidate[0])) return candidate[0].trim();
      if (labelRegex.lastIndex <= hit.index) labelRegex.lastIndex = hit.index + 1;
    }
  }
  return '';
};

/**
 * The document's own identifying number — a passport number, a card number, a
 * policy number and so on. The machine readable zone is tried first because it
 * survives OCR better than the printed label does, then a Luhn-valid card
 * number, then whatever follows a recognised label.
 */
export const extractDocumentNumber = (text: string): string => {
  if (!text || typeof text !== 'string') return '';
  const { documentNumber } = extractDatesFromMrz(text);
  if (documentNumber && isPlausibleNumber(documentNumber)) return documentNumber;
  const card = findCardNumber(text);
  if (card) return card;
  return findNumberAfterLabel(text, NUMBER_LABELS);
};

/**
 * What the list needs to know about a document: its dates and its number. It is
 * stored encrypted beside the payload so a tab full of scanned PDFs can be
 * listed without decrypting a single file.
 */
export type DocMeta = { startDate: string; endDate: string; number: string };

export const summariseDocument = (
  title: string,
  payload: { notes: string; startDate: string; endDate: string; number: string },
): DocMeta => {
  const text = `${title || ''}\n${payload.notes || ''}`;
  const detected = extractDatesFromText(text);
  return {
    startDate: payload.startDate || detected.startDate,
    endDate: payload.endDate || detected.endDate,
    number: payload.number || extractDocumentNumber(text),
  };
};

/**
 * Ciphertext above this size is left out of the background summary pass. A
 * scanned PDF can be tens of megabytes and decrypting one costs seconds; its
 * summary is written the first time the user opens it instead.
 */
const META_BACKFILL_MAX_BYTES = 512 * 1024;

/** How long before the end date a document starts showing the amber warning. */
const EXPIRY_WARNING_DAYS = 7;

export type ExpiryStatus = 'expired' | 'expiring' | 'safe';

/** Midnight-based day difference, so "expires today" is 0 rather than a fraction. */
const daysUntil = (target: Date): number => {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(target) - startOfDay(new Date())) / 86400000);
};

/**
 * Traffic-light state for a document's end date. Returns null when the document
 * carries no expiry at all, so those keep their neutral styling.
 */
export const getExpiryStatus = (endDate: string): { status: ExpiryStatus; days: number } | null => {
  const parsed = parseDateString((endDate || '').trim());
  if (!parsed) return null;

  const days = daysUntil(parsed);
  if (days < 0) return { status: 'expired', days };
  if (days <= EXPIRY_WARNING_DAYS) return { status: 'expiring', days };
  return { status: 'safe', days };
};

/** Border, background and text colours for each state, plus the list label. */
const EXPIRY_STYLES: Record<ExpiryStatus, { border: string; background: string; text: string; highlight?: string }> = {
  expired: { border: '#ef4444', background: '#fef2f2', text: '#b91c1c' },
  expiring: { border: '#f59e0b', background: '#fffbeb', text: '#b45309', highlight: '#fef08a' },
  safe: { border: '#22c55e', background: '#f0fdf4', text: '#15803d' },
};

const expiryLabel = (status: ExpiryStatus, days: number): string => {
  if (status === 'expired') {
    const ago = Math.abs(days);
    return ago === 0 ? 'Expired today' : `Expired ${ago} day${ago === 1 ? '' : 's'} ago`;
  }
  if (status === 'expiring') {
    if (days === 0) return 'Expires today';
    return `Expires in ${days} day${days === 1 ? '' : 's'}`;
  }
  return 'Valid';
};

/**
 * The date fields accept free text as well as calendar picks, so a typo like
 * "32/13/2025" would otherwise be stored verbatim and read back as a date the
 * app cannot parse. Empty is allowed — only one of the two is ever required.
 */
const validateExpiryDates = (startDate: string, endDate: string): boolean => {
  const start = startDate.trim();
  const end = endDate.trim();

  for (const [label, value] of [['Start Date', start], ['End Date', end]] as const) {
    if (value && !parseDateString(value)) {
      Alert.alert('Invalid Date', `${label} "${value}" is not a valid date. Use DD-MM-YYYY or pick one from the calendar.`);
      return false;
    }
  }

  const parsedStart = parseDateString(start);
  const parsedEnd = parseDateString(end);
  if (parsedStart && parsedEnd && parsedStart.getTime() > parsedEnd.getTime()) {
    Alert.alert('Invalid Dates', 'Start Date cannot be after End Date.');
    return false;
  }

  return true;
};

export default function TabDetailScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const tabId = route?.params?.tabId;
  const unlockPin = route?.params?.unlockPin;
  const { tabs, activeDocuments, loadDocumentsForTab, addDocument, updateDocument, deleteDocument, getDocumentContent, setDocumentMeta, logout, currentUser, themeVersion } = useLockerStore();
  const styles = useMemo(() => createStyles(), [themeVersion]);
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < 768;

  const candidateKeys = useMemo(() => {
    return [currentUser?.pinHash, unlockPin, 'default_fallback'].filter(Boolean) as string[];
  }, [currentUser?.pinHash, unlockPin]);

  const decryptDoc = (cipherText: string): string => {
    return CryptoService.decryptWithKeys(cipherText, candidateKeys);
  };

  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);

  // New document
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docHasExpiry, setDocHasExpiry] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docStartDate, setDocStartDate] = useState('');
  const [docEndDate, setDocEndDate] = useState('');
  const [docDatesEdited, setDocDatesEdited] = useState(false);
  const [fileUris, setFileUris] = useState<string[]>([]);
  const [fileType, setFileType] = useState<'image' | 'pdf' | null>(null);

  // Edit document
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [editDocTitle, setEditDocTitle] = useState('');
  const [editDocContent, setEditDocContent] = useState('');
  const [editDocHasExpiry, setEditDocHasExpiry] = useState(false);
  const [editDocNumber, setEditDocNumber] = useState('');
  const [editDocStartDate, setEditDocStartDate] = useState('');
  const [editDocEndDate, setEditDocEndDate] = useState('');
  const [editDocDatesEdited, setEditDocDatesEdited] = useState(false);
  const [dateVerifyMode, setDateVerifyMode] = useState<'add' | 'edit' | null>(null);
  const [datePickerTarget, setDatePickerTarget] = useState<'add-start' | 'add-end' | 'edit-start' | 'edit-end' | null>(null);
  const [isScanningDates, setIsScanningDates] = useState(false);
  const [dateScanStatus, setDateScanStatus] = useState<'idle' | 'found' | 'none' | 'unavailable'>('idle');
  const [rasterTarget, setRasterTarget] = useState<{ base64: string; fileUri: string } | null>(null);
  const rasterResolveRef = useRef<((value: string) => void) | null>(null);
  const [editFileUris, setEditFileUris] = useState<string[]>([]);
  const [editFileType, setEditFileType] = useState<'image' | 'pdf' | 'text' | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Web Camera
  const [webCameraVisible, setWebCameraVisible] = useState(false);

  // Active image index for crop modal
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [cropTarget, setCropTarget] = useState<'add' | 'edit' | null>(null);

  // Viewing document (Popup)
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [decryptedText, setDecryptedText] = useState('');
  const [decryptedArray, setDecryptedArray] = useState<string[]>([]);
  // A large file takes a moment to decrypt, and "nothing here" is the wrong
  // thing to show while it is still being read
  const [isOpeningDoc, setIsOpeningDoc] = useState(false);

  // Right-pane preview
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewData, setPreviewData] = useState<string>('');
  const [previewDataArray, setPreviewDataArray] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [selectedForDownload, setSelectedForDownload] = useState<Record<number, boolean>>({});
  const previewRequestIdRef = useRef<number>(0);

  // Delete confirmation
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<any>(null);
  // A picture can go out as itself or gathered into a PDF, so it asks
  const [shareChoice, setShareChoice] = useState<{ doc: any; files: string[] } | null>(null);
  const [isBuildingPdf, setIsBuildingPdf] = useState(false);

  // In-memory cache for decrypted document content to prevent duplicate decryptions
  const decryptionCacheRef = useRef<Map<string | number, { plainText: string; array: string[] }>>(new Map());

  // Summaries recovered for documents saved before the column existed. The ref
  // is what the background pass reads; the state is what re-renders the list.
  const [legacyMeta, setLegacyMeta] = useState<Map<number, DocMeta>>(new Map());
  const legacyMetaRef = useRef<Map<number, DocMeta>>(new Map());

  /**
   * The decrypted payload for one document. List rows no longer carry the file
   * bytes, so the ciphertext is read from the database the first time something
   * opens the document, and the result is kept.
   */
  const loadPlainText = async (doc: any): Promise<string> => {
    if (!doc) return '';
    if (doc.id != null) {
      const cached = decryptionCacheRef.current.get(doc.id);
      if (cached) return cached.plainText;
    }
    const cipher = doc.encryptedContent || (doc.id != null ? await getDocumentContent(doc.id) : '');
    return decryptDoc(cipher || '');
  };

  /**
   * Writes a document's summary the first time it is opened, so that the list
   * can show its expiry from then on without touching the payload again.
   */
  const rememberMeta = (doc: any, payload: { notes: string; startDate: string; endDate: string; number: string }) => {
    if (!doc || doc.id == null || doc.encryptedMeta) return;
    if (legacyMetaRef.current.has(doc.id)) return;
    const meta = summariseDocument(doc.title || '', payload);
    legacyMetaRef.current.set(doc.id, meta);
    setLegacyMeta(prev => new Map(prev).set(doc.id, meta));
    setDocumentMeta(doc.id, JSON.stringify(meta), currentUser?.pinHash || 'default_fallback');
  };

  // Document Sort state
  type DocSortOption = 'newest' | 'oldest' | 'name_asc' | 'name_desc';
  const [sortOption, setSortOption] = useState<DocSortOption>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);

  useEffect(() => {
    const loadDocSortPref = async () => {
      const saved = await StorageService.getItem('@offline_locker_doc_sort_option');
      if (saved && ['newest', 'oldest', 'name_asc', 'name_desc'].includes(saved)) {
        setSortOption(saved as DocSortOption);
      }
    };
    loadDocSortPref();
  }, []);

  const DOC_SORT_OPTIONS: { id: DocSortOption; label: string; desc: string; icon: any }[] = [
    { id: 'newest', label: 'Newest First', desc: 'Recently added files appear first', icon: 'time-outline' },
    { id: 'oldest', label: 'Oldest First', desc: 'Earliest added files appear first', icon: 'hourglass-outline' },
    { id: 'name_asc', label: 'File Name (A to Z)', desc: 'Alphabetical file order', icon: 'text-outline' },
    { id: 'name_desc', label: 'File Name (Z to A)', desc: 'Reverse alphabetical order', icon: 'text-outline' },
  ];

  const getDocSortLabel = (opt: DocSortOption) => {
    switch (opt) {
      case 'newest': return 'Newest First';
      case 'oldest': return 'Oldest First';
      case 'name_asc': return 'Name (A–Z)';
      case 'name_desc': return 'Name (Z–A)';
      default: return 'Sort';
    }
  };

  const sortedDocuments = useMemo(() => {
    const list = [...activeDocuments];
    switch (sortOption) {
      case 'newest':
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case 'oldest':
        return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case 'name_asc':
        return list.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
      case 'name_desc':
        return list.sort((a, b) => (b.title || '').localeCompare(a.title || '', undefined, { sensitivity: 'base' }));
      default:
        return list;
    }
  }, [activeDocuments, sortOption]);

  useEffect(() => {
    // Reset preview state and decryption cache when switching tabs
    previewRequestIdRef.current++;
    setPreviewDoc(null);
    setPreviewData('');
    setPreviewDataArray([]);
    setPreviewLoading(false);
    decryptionCacheRef.current.clear();
    setLoading(true);

    const fetchDocs = async () => {
      await loadDocumentsForTab(tabId);
      setLoading(false);
    };
    fetchDocs();

    return () => {
      // Clear preview and active documents on unmount so they do not bleed into other tabs
      previewRequestIdRef.current++;
      setPreviewDoc(null);
      setPreviewData('');
      setPreviewDataArray([]);
      setPreviewLoading(false);
      decryptionCacheRef.current.clear();
      useLockerStore.setState({ activeDocuments: [] });
    };
  }, [tabId]);

  useEffect(() => {
    if (loading) return;

    if (activeDocuments.length > 0) {
      // Validate that previewDoc belongs to current activeDocuments for this tab
      const isCurrentPreviewValid = previewDoc && activeDocuments.some(d => d.id === previewDoc.id);
      if (!isCurrentPreviewValid) {
        handleSelectPreview(sortedDocuments[0] || activeDocuments[0]);
      }
    } else {
      setPreviewDoc(null);
      setPreviewData('');
      setPreviewDataArray([]);
    }
  }, [activeDocuments, previewDoc, loading]);

  const isSharingRef = useRef(false);
  const isPickerBusyRef = useRef(false);
  const isViewingRef = useRef(false);
  const lastTapRef = useRef<{ id: string | number; time: number } | null>(null);
  const rightPaneTapRef = useRef<{ id: string | number; time: number } | null>(null);
  const tapTimeoutRef = useRef<any>(null);

  /**
   * Turns whatever a picker handed back into a JPEG data URI of a sane size.
   *
   * A camera asset arrives as a path, and that is what gets resized: asking
   * the picker for base64 as well means a full-resolution photo is built into
   * a string first, which on an iPhone can come back empty or take the app
   * down with it. Reading the file only after it has been scaled keeps the
   * whole operation inside a few hundred kilobytes.
   */
  const optimizeImageUri = async (uri: string): Promise<string> => {
    if (!uri) return uri;
    if (Platform.OS !== 'web' && !uri.startsWith('data:') && !uri.startsWith('file:') && !uri.startsWith('content:') && !uri.startsWith('ph://') && !uri.startsWith('assets-library://')) {
      return uri;
    }
    try {
      const res = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (res && res.base64) {
        return `data:image/jpeg;base64,${res.base64}`;
      }
      // The manipulator wrote a file but withheld the string, which iOS does
      // for larger images; reading it back is cheap now that it is scaled
      if (res && res.uri && Platform.OS !== 'web') {
        const base64 = await FileSystem.readAsStringAsync(res.uri, { encoding: 'base64' });
        if (base64) return `data:image/jpeg;base64,${base64}`;
      }
    } catch (e) {
      console.warn('Image optimization failed:', e);
    }

    // Last resort: hand back the bytes as they are rather than losing the photo
    if (!uri.startsWith('data:') && Platform.OS !== 'web') {
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        if (base64) return `data:image/jpeg;base64,${base64}`;
      } catch (e) {
        console.warn('Could not read captured image:', e);
      }
    }
    return uri;
  };

  const [webCameraTarget, setWebCameraTarget] = useState<'add' | 'edit'>('add');

  /**
   * Runs when a document is attached: reads dates out of the file name, any typed
   * notes and (for PDFs) readable text inside the file, then fills the fields.
   * Manually entered dates are never overwritten.
   */
  /** Rasterizes page 1 of a PDF via an offscreen WebView so OCR has an image to read. */
  const renderPdfFirstPage = async (dataUri: string): Promise<string> => {
    if (Platform.OS === 'web') return '';

    const source = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    if (!source) return '';

    // Written out first so the page can read the bytes itself. Streaming a scan
    // into the WebView 60 KB at a time meant hundreds of round trips before OCR
    // could even start.
    let fileUri = '';
    try {
      fileUri = `${await ensureDecryptedCacheDir()}ocr_source.pdf`;
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      await FileSystem.writeAsStringAsync(fileUri, source, { encoding: 'base64' });
    } catch (e) {
      fileUri = '';
    }

    return new Promise((resolve) => {
      const finish = (value: string) => {
        clearTimeout(timer);
        rasterResolveRef.current = null;
        setRasterTarget(null);
        resolve(value);
      };
      const timer = setTimeout(() => finish(''), 30000);
      rasterResolveRef.current = finish;
      setRasterTarget({ base64: source, fileUri });
    });
  };

  const autoFetchDetailsFromDocument = async (isEdit: boolean, sources: { fileName?: string; dataUri?: string }) => {
    const alreadyEdited = isEdit ? editDocDatesEdited : docDatesEdited;
    if (alreadyEdited) return;

    const notes = isEdit ? editDocContent : docContent;
    const title = isEdit ? editDocTitle : docTitle;
    const isPdf = !!sources.dataUri && sources.dataUri.includes('application/pdf');
    const pdfText = isPdf ? extractTextFromPdfDataUri(sources.dataUri!) : '';

    type Found = { startDate: string; endDate: string; number: string };

    /**
     * Writes through only the fields that were actually found. Assigning the
     * blanks too would wipe a value the previous pass had recovered.
     */
    const apply = (found: Found) => {
      if (isEdit) {
        if (found.startDate) setEditDocStartDate(found.startDate);
        if (found.endDate) setEditDocEndDate(found.endDate);
        if (found.number) setEditDocNumber(found.number);
        if (found.startDate || found.endDate) setEditDocHasExpiry(true);
      } else {
        if (found.startDate) setDocStartDate(found.startDate);
        if (found.endDate) setDocEndDate(found.endDate);
        if (found.number) setDocNumber(found.number);
        if (found.startDate || found.endDate) setDocHasExpiry(true);
      }
    };

    const scan = (text: string): Found => {
      const mrz = extractDatesFromMrz(text);
      const labelled = extractDatesFromText(text);
      // MRZ expiry is more reliable than an OCR-misread printed label
      return {
        startDate: labelled.startDate,
        endDate: mrz.endDate || labelled.endDate,
        number: extractDocumentNumber(text),
      };
    };

    const merge = (a: Found, b: Found): Found => ({
      startDate: a.startDate || b.startDate,
      endDate: a.endDate || b.endDate,
      number: a.number || b.number,
    });

    const textSources = [sources.fileName || '', title, notes, pdfText].filter(Boolean).join('\n');
    let found = scan(textSources);
    apply(found);

    const isComplete = (f: Found) => !!f.startDate && !!f.endDate && !!f.number;

    // Anything still missing is worth a look at the document itself. Returning
    // early just because a filename yielded a number is what previously stopped
    // photos from ever reaching OCR.
    if (isComplete(found) || !sources.dataUri) {
      setDateScanStatus(found.startDate || found.endDate || found.number ? 'found' : 'none');
      return;
    }

    // A scanned page carries no text layer, so reading it needs on-device
    // recognition. Expo Go and the web build have no ML Kit, and staying quiet
    // about that looked like the document simply had no dates on it.
    if (!isOcrAvailable()) {
      setDateScanStatus(found.startDate || found.endDate || found.number ? 'found' : 'unavailable');
      return;
    }

    setIsScanningDates(true);
    try {
      const imageUri = isPdf ? await renderPdfFirstPage(sources.dataUri) : sources.dataUri;
      const ocrText = imageUri ? await recognizeTextFromImage(imageUri) : '';
      if (ocrText) {
        found = merge(found, scan(`${textSources}\n${ocrText}`));
        apply(found);
      }
      setDateScanStatus(found.startDate || found.endDate || found.number ? 'found' : 'none');
    } finally {
      setIsScanningDates(false);
    }
  };

  const handleTakePhoto = async (isEdit = false) => {
    if (isPickerBusyRef.current) return;
    isPickerBusyRef.current = true;
    try {
      if (Platform.OS === 'web') {
        setWebCameraTarget(isEdit ? 'edit' : 'add');
        setWebCameraVisible(true);
        return;
      }

      const permissionResult = await withoutAutoLock(() => ImagePicker.requestCameraPermissionsAsync());
      if (!permissionResult.granted) {
        Alert.alert('Permission required', 'Camera permission is required to take photos.');
        return;
      }

      const result = await withoutAutoLock(() => ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
      }));

      if (!result.canceled && result.assets && result.assets.length > 0) {
        // The asset's own path is the input: see optimizeImageUri
        const newUri = await optimizeImageUri(result.assets[0].uri);
        if (!newUri || !newUri.startsWith('data:')) {
          Alert.alert('Could not save the photo', 'The picture could not be read from the camera. Please try again.');
          return;
        }
        if (isEdit) {
          const newIndex = editFileUris.length;
          setEditFileUris(prev => [...prev, newUri]);
          setEditFileType('image');
          setCropTarget('edit');
          setCropIndex(newIndex);
        } else {
          const newIndex = fileUris.length;
          setFileUris(prev => [...prev, newUri]);
          setFileType('image');
          setCropTarget('add');
          setCropIndex(newIndex);
          if (!docTitle.trim()) {
            setDocTitle('Photo');
          }
        }
        autoFetchDetailsFromDocument(isEdit, { dataUri: newUri });
      }
    } catch (e) {
      console.warn('Camera launch error:', e);
    } finally {
      isPickerBusyRef.current = false;
    }
  };

  const handleWebCameraCapture = async (base64DataUri: string) => {
    const optimized = await optimizeImageUri(base64DataUri);
    if (webCameraTarget === 'edit') {
      const newIndex = editFileUris.length;
      setEditFileUris(prev => [...prev, optimized]);
      setEditFileType('image');
      setWebCameraVisible(false);
      setCropTarget('edit');
      setCropIndex(newIndex);
    } else {
      const newIndex = fileUris.length;
      setFileUris(prev => [...prev, optimized]);
      setFileType('image');
      setWebCameraVisible(false);
      setCropTarget('add');
      setCropIndex(newIndex);
      if (!docTitle.trim()) {
        setDocTitle('Photo');
      }
    }
    autoFetchDetailsFromDocument(webCameraTarget === 'edit', { dataUri: optimized });
  };

  const handleGalleryPick = async (isEdit = false) => {
    if (isPickerBusyRef.current) return;
    isPickerBusyRef.current = true;
    try {
      const result = await withoutAutoLock(() => ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
      }));
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const firstAsset = result.assets[0];
        const newUri = await optimizeImageUri(firstAsset.uri);
        if (!newUri || !newUri.startsWith('data:')) {
          Alert.alert('Could not add the picture', 'The image could not be read. Please try another one.');
          return;
        }
        let pickedName = (firstAsset as any).file?.name || firstAsset.fileName || (firstAsset.uri ? firstAsset.uri.split('/').pop() : '') || '';
        if (pickedName) {
          try { pickedName = decodeURIComponent(pickedName); } catch (e) {}
        }

        if (isEdit) {
          const newIndex = editFileUris.length;
          setEditFileUris(prev => [...prev, newUri]);
          setEditFileType('image');
          setCropTarget('edit');
          setCropIndex(newIndex);
        } else {
          const newIndex = fileUris.length;
          setFileUris(prev => [...prev, newUri]);
          setFileType('image');
          setCropTarget('add');
          setCropIndex(newIndex);

          if (pickedName && !pickedName.startsWith('data:') && !pickedName.startsWith('blob:')) {
            setDocTitle(pickedName);
          } else if (!docTitle.trim()) {
            setDocTitle('Image');
          }
        }

        autoFetchDetailsFromDocument(isEdit, { fileName: pickedName, dataUri: newUri });
      }
    } catch (e) {
      console.warn('Gallery pick error:', e);
    } finally {
      isPickerBusyRef.current = false;
    }
  };

  const handleUploadFile = async (isEdit = false) => {
    if (isPickerBusyRef.current) return;
    isPickerBusyRef.current = true;
    try {
      const result = await withoutAutoLock(() => DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      }));

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newUris: string[] = [];

        for (const asset of result.assets) {
          let dataUri = '';
          if (Platform.OS === 'web') {
            const reader = new FileReader();
            const uriPromise = new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
            });
            reader.readAsDataURL(asset.file as any);
            dataUri = await uriPromise;
          } else {
            const base64Data = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
            dataUri = `data:application/pdf;base64,${base64Data}`;
          }

          newUris.push(dataUri);
        }

        const firstAsset = result.assets[0];
        let fileName = firstAsset.name || (firstAsset.file as any)?.name || (firstAsset.uri ? firstAsset.uri.split('/').pop() : '') || 'Document.pdf';
        if (fileName) {
          try { fileName = decodeURIComponent(fileName); } catch (e) {}
        }

        if (isEdit) {
          setEditFileType('pdf');
          setEditFileUris(prev => [...prev, ...newUris]);
        } else {
          setFileType('pdf');
          setFileUris(prev => [...prev, ...newUris]);
          setDocTitle(fileName);
        }

        autoFetchDetailsFromDocument(isEdit, { fileName, dataUri: newUris[0] });
      }
    } catch (error) {
      console.warn('PDF pick error:', error);
      Alert.alert('Could not add the PDF', saveFailureMessage(error));
    } finally {
      isPickerBusyRef.current = false;
    }
  };

  /** Dismissing the add window clears its draft, exactly as Cancel does. */
  const closeAddDocument = () => {
    if (isEncrypting) return;
    setModalVisible(false);
    setFileUris([]);
    setFileType(null);
    setDocTitle('');
    setDocContent('');
    setDocNumber('');
    setDocStartDate('');
    setDocEndDate('');
    setDocDatesEdited(false);
    setDocHasExpiry(false);
    setDateScanStatus('idle');
  };

  /** The same for the edit window. */
  const closeEditDocument = () => {
    if (isUpdating) return;
    setEditModalVisible(false);
    setEditingDoc(null);
    setEditDocTitle('');
    setEditDocContent('');
    setEditDocStartDate('');
    setEditDocEndDate('');
    setEditDocDatesEdited(false);
    setEditDocHasExpiry(false);
    setEditFileUris([]);
    setEditFileType(null);
  };

  const handleAddDocument = async () => {
    const trimmedTitle = docTitle.trim();
    if (!trimmedTitle) {
      Alert.alert('Error', 'Please enter a title for the document.');
      return;
    }

    const isDuplicate = activeDocuments.some(
      d => (d.title || '').trim().toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (isDuplicate) {
      Alert.alert('Duplicate File Name', `A document named "${trimmedTitle}" already exists in this tab. Please choose a different title.`);
      return;
    }

    if (isEncrypting) return;

    if (docHasExpiry && !validateExpiryDates(docStartDate, docEndDate)) return;

    // Dates may have been auto-filled from the document, so ask the user to confirm them first
    if (docHasExpiry && (docStartDate.trim() || docEndDate.trim())) {
      setDateVerifyMode('add');
      return;
    }

    performAddDocument();
  };

  const performAddDocument = async () => {
    const trimmedTitle = docTitle.trim();
    if (isEncrypting) return;

    setIsEncrypting(true);

    setTimeout(async () => {
      try {
        const encryptionKey = currentUser?.pinHash || 'default_fallback';
        const type = fileType ? fileType : 'text';

        let processedUris = fileUris;
        if (type === 'image' && fileUris.length > 0) {
          processedUris = await Promise.all(fileUris.map(uri => optimizeImageUri(uri)));
        }

        const startDate = docHasExpiry ? docStartDate.trim() : '';
        const endDate = docHasExpiry ? docEndDate.trim() : '';
        const number = docNumber.trim();
        // The number is independent of the expiry, so it alone is enough to
        // require the structured payload rather than a bare notes string
        const hasDetails = Boolean(startDate || endDate || number);

        let contentToEncrypt = '';
        if (processedUris.length > 0 && (docContent.trim() || hasDetails)) {
          contentToEncrypt = JSON.stringify({ notes: docContent.trim(), files: processedUris, startDate, endDate, number });
        } else if (processedUris.length > 0) {
          contentToEncrypt = JSON.stringify(processedUris);
        } else if (hasDetails) {
          contentToEncrypt = JSON.stringify({ notes: docContent.trim(), files: [], startDate, endDate, number });
        } else {
          contentToEncrypt = docContent;
        }

        const meta = summariseDocument(trimmedTitle, { notes: docContent.trim(), startDate, endDate, number });
        await addDocument(tabId, trimmedTitle, type, contentToEncrypt, encryptionKey, JSON.stringify(meta));
        setModalVisible(false);
        setDocTitle(''); setDocContent(''); setDocNumber(''); setDocStartDate(''); setDocEndDate(''); setDocDatesEdited(false); setDocHasExpiry(false); setDateScanStatus('idle'); setFileUris([]); setFileType(null);
      } catch (e) {
        console.error('handleAddDocument error:', e);
        Alert.alert('Could not save', saveFailureMessage(e));
      } finally {
        setIsEncrypting(false);
      }
    }, 50);
  };

  /** Copies a number to the clipboard and confirms it, since nothing else would. */
  const handleCopyNumber = async (value: string) => {
    const trimmed = (value || '').trim();
    if (!trimmed) return;
    try {
      await Clipboard.setStringAsync(trimmed);
      setCopiedNumber(trimmed);
      setTimeout(() => setCopiedNumber(''), 2500);
    } catch (e) {
      Alert.alert('Copy failed', 'Could not copy the number to the clipboard.');
    }
  };

  const handleOpenEditDoc = async (doc: any) => {
    if (!doc) return;
    setEditingDoc(doc);
    setEditDocTitle(doc.title);
    setEditFileType(doc.type as any);

    const plainText = await loadPlainText(doc);

    const payload = parseDecryptedPayload(plainText);
    rememberMeta(doc, payload);
    setEditDocContent(payload.notes);
    setEditFileUris(payload.files);

    // Saved dates win; otherwise try to read them out of the document text
    const detected = extractDatesFromText(`${doc.title || ''}\n${payload.notes}`);
    const startDate = payload.startDate || detected.startDate;
    const endDate = payload.endDate || detected.endDate;
    setEditDocStartDate(startDate);
    setEditDocEndDate(endDate);
    setEditDocDatesEdited(Boolean(payload.startDate || payload.endDate));
    setEditDocHasExpiry(Boolean(startDate || endDate));

    // Same rule for the number: a saved value wins over a re-read of the text
    setEditDocNumber(payload.number || extractDocumentNumber(`${doc.title || ''}\n${payload.notes}`));

    setEditModalVisible(true);
  };

  const handleSaveEditDoc = async () => {
    const trimmedTitle = editDocTitle.trim();
    if (!trimmedTitle || !editingDoc) {
      Alert.alert('Error', 'Please enter a title for the document.');
      return;
    }

    const isDuplicate = activeDocuments.some(
      d => d.id !== editingDoc.id && (d.title || '').trim().toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (isDuplicate) {
      Alert.alert('Duplicate File Name', `A document named "${trimmedTitle}" already exists in this tab. Please choose a different title.`);
      return;
    }

    if (isUpdating) return;

    if (editDocHasExpiry && !validateExpiryDates(editDocStartDate, editDocEndDate)) return;

    if (editDocHasExpiry && (editDocStartDate.trim() || editDocEndDate.trim())) {
      setDateVerifyMode('edit');
      return;
    }

    performSaveEditDoc();
  };

  const performSaveEditDoc = async () => {
    if (isUpdating || !editingDoc) return;

    setIsUpdating(true);

    setTimeout(async () => {
      try {
        const encryptionKey = currentUser?.pinHash || 'default_fallback';
        const type = editFileType ? editFileType : 'text';

        let processedUris = editFileUris;
        if (type === 'image' && editFileUris.length > 0) {
          processedUris = await Promise.all(editFileUris.map(uri => optimizeImageUri(uri)));
        }

        const startDate = editDocHasExpiry ? editDocStartDate.trim() : '';
        const endDate = editDocHasExpiry ? editDocEndDate.trim() : '';
        const number = editDocNumber.trim();
        // The number is independent of the expiry, so it alone is enough to
        // require the structured payload rather than a bare notes string
        const hasDetails = Boolean(startDate || endDate || number);

        let contentToEncrypt = '';
        if (processedUris.length > 0 && (editDocContent.trim() || hasDetails)) {
          contentToEncrypt = JSON.stringify({ notes: editDocContent.trim(), files: processedUris, startDate, endDate, number });
        } else if (processedUris.length > 0) {
          contentToEncrypt = JSON.stringify(processedUris);
        } else if (hasDetails) {
          contentToEncrypt = JSON.stringify({ notes: editDocContent.trim(), files: [], startDate, endDate, number });
        } else {
          contentToEncrypt = editDocContent;
        }

        const meta = summariseDocument(editDocTitle.trim(), { notes: editDocContent.trim(), startDate, endDate, number });
        await updateDocument(editingDoc.id, tabId, editDocTitle, contentToEncrypt, encryptionKey, JSON.stringify(meta));

        const updatedDoc = { ...editingDoc, title: editDocTitle.trim() };

        if (editingDoc.id != null) {
          // Seed the cache with what was just saved. Encrypting a second copy
          // here only to decrypt it again on the next render doubled the cost
          // of saving a large file.
          decryptionCacheRef.current.set(editingDoc.id, {
            plainText: contentToEncrypt,
            array: parseDecryptedContent(contentToEncrypt),
          });
          legacyMetaRef.current.set(editingDoc.id, meta);
          setLegacyMeta(prev => new Map(prev).set(editingDoc.id, meta));
        }

        if (previewDoc?.id === editingDoc.id) {
          handleSelectPreview(updatedDoc);
        }
        if (selectedDoc?.id === editingDoc.id) {
          setSelectedDoc(updatedDoc);
          setDecryptedText(contentToEncrypt);
        }

        setEditModalVisible(false);
        setEditingDoc(null);
        setEditDocTitle(''); setEditDocContent(''); setEditDocStartDate(''); setEditDocEndDate(''); setEditDocDatesEdited(false); setEditDocHasExpiry(false); setEditFileUris([]); setEditFileType(null);
      } catch (e) {
        console.error('handleSaveEditDoc error:', e);
        Alert.alert('Could not save', saveFailureMessage(e));
      } finally {
        setIsUpdating(false);
      }
    }, 50);
  };

  const parseDecryptedPayload = (plainText: string): { notes: string; files: string[]; startDate: string; endDate: string; number: string } => {
    if (!plainText || typeof plainText !== 'string' || plainText.startsWith('⚠️')) return { notes: '', files: [], startDate: '', endDate: '', number: '' };
    const trimmed = plainText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          const notes = typeof parsed.notes === 'string' ? parsed.notes : '';
          const files = Array.isArray(parsed.files) ? parsed.files.filter((f: any) => typeof f === 'string') : [];
          const startDate = typeof parsed.startDate === 'string' ? parsed.startDate : '';
          const endDate = typeof parsed.endDate === 'string' ? parsed.endDate : '';
          const number = typeof parsed.number === 'string' ? parsed.number : '';
          return { notes, files, startDate, endDate, number };
        }
      } catch (e) { }
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const files = parsed.filter((item: any) => typeof item === 'string' && item.length > 0);
          return { notes: '', files, startDate: '', endDate: '', number: '' };
        }
      } catch (e) { }
    }
    return { notes: plainText, files: [], startDate: '', endDate: '', number: '' };
  };

  const parseDecryptedContent = (plainText: string): string[] => {
    return parseDecryptedPayload(plainText).files;
  };

  /** The stored summary for a document, or null if it has none yet. */
  const readMeta = (doc: any): DocMeta | null => {
    if (!doc?.encryptedMeta) return null;
    try {
      const parsed = JSON.parse(decryptDoc(doc.encryptedMeta));
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        startDate: typeof parsed.startDate === 'string' ? parsed.startDate : '',
        endDate: typeof parsed.endDate === 'string' ? parsed.endDate : '',
        number: typeof parsed.number === 'string' ? parsed.number : '',
      };
    } catch (e) {
      return null;
    }
  };

  const metaByDocId = useMemo(() => {
    const map = new Map<number, DocMeta>();
    activeDocuments.forEach(doc => {
      if (doc.id == null) return;
      const meta = readMeta(doc) || legacyMeta.get(doc.id);
      if (meta) map.set(doc.id, meta);
    });
    return map;
  }, [activeDocuments, candidateKeys, legacyMeta]);

  /**
   * Expiry state per document, taken from the summary. This used to decrypt
   * every document in the tab, payload and all, which is what made opening a
   * tab of large PDFs take so long.
   */
  const expiryByDocId = useMemo(() => {
    const map = new Map<number, { status: ExpiryStatus; days: number }>();
    activeDocuments.forEach(doc => {
      if (doc.id == null) return;
      const endDate = metaByDocId.get(doc.id)?.endDate || extractDatesFromText(doc.title || '').endDate;
      const state = getExpiryStatus(endDate || '');
      if (state) map.set(doc.id, state);
    });
    return map;
  }, [activeDocuments, metaByDocId]);

  /**
   * Documents saved before summaries existed get one here, a document per tick
   * so the list stays responsive. Large payloads are skipped: they are summarised
   * when the user opens them, the only time decrypting one is worth it.
   */
  useEffect(() => {
    const pending = activeDocuments.filter(doc => {
      if (doc.id == null || doc.encryptedMeta) return false;
      if (legacyMetaRef.current.has(doc.id)) return false;
      return (doc.contentLength || 0) <= META_BACKFILL_MAX_BYTES;
    });
    if (pending.length === 0) return;

    let cancelled = false;
    const encryptionKey = currentUser?.pinHash || 'default_fallback';

    (async () => {
      for (const doc of pending) {
        // Yield first, so the list has painted before any decrypting starts
        await new Promise(resolve => setTimeout(resolve, 0));
        if (cancelled) return;
        try {
          const plainText = await loadPlainText(doc);
          if (cancelled) return;
          if (!plainText || plainText.startsWith('\u26a0\ufe0f')) continue;
          const payload = parseDecryptedPayload(plainText);
          const meta = summariseDocument(doc.title || '', payload);
          legacyMetaRef.current.set(doc.id!, meta);
          setLegacyMeta(prev => new Map(prev).set(doc.id!, meta));
          // An image's first file is its thumbnail, and the row renderer reads
          // it straight from this cache rather than decrypting again
          if (doc.type === 'image') {
            decryptionCacheRef.current.set(doc.id!, { plainText, array: payload.files });
          }
          await setDocumentMeta(doc.id!, JSON.stringify(meta), encryptionKey);
        } catch (e) {
          // A document that will not decrypt simply gets no summary
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeDocuments]);

  const getSafeImageUri = (uri: string) => {
    if (!uri) return '';
    if (uri.startsWith('data:')) return uri;
    if (uri.startsWith('http') || uri.startsWith('file://')) return encodeURI(uri);
    return ''; // Invalid URI prevents crash
  };

  /**
   * Cache only. Decrypting here ran on every re-render of every row; the
   * background pass above fills this in once instead.
   */
  const getThumbnailForItem = (item: any): string | null => {
    if (item.type !== 'image' || item.id == null) return null;
    return decryptionCacheRef.current.get(item.id)?.array[0] || null;
  };

  /**
   * Writes the decrypted files to the cache and returns their paths. A PDF goes
   * to disk rather than staying a data URI: a scan is tens of megabytes, and
   * handing the viewer a path instead of that string is the difference between
   * opening at once and locking up for half a minute.
   */
  const prepareLocalFiles = async (dataUris: string[], docTitle: string, type: string, docId?: any): Promise<string[]> => {
    if (Platform.OS === 'web' || type === 'image') return dataUris;

    const safeTitle = (docTitle || 'doc').replace(/[^a-z0-9]/gi, '_');
    const prefix = docId ? `${safeTitle}_${docId}` : safeTitle;
    const dir = await ensureDecryptedCacheDir();

    return Promise.all(
      dataUris.map(async (uri, i) => {
        if (uri.startsWith('data:')) {
          try {
            const ext = type === 'pdf' ? 'pdf' : 'jpg';
            const tempUri = `${dir}${prefix}_p_${i}.${ext}`;
            
            // Check if file already exists on disk to avoid redundant writes and file locks
            const fileInfo = await FileSystem.getInfoAsync(tempUri);
            if (fileInfo.exists && fileInfo.size && fileInfo.size > 0) {
              return tempUri;
            }

            const base64Data = uri.includes(',') ? uri.split(',')[1] : uri;
            await FileSystem.writeAsStringAsync(tempUri, base64Data, { encoding: 'base64' });
            return tempUri;
          } catch (e) {
            return uri;
          }
        }
        return uri;
      })
    );
  };

  const handleViewDoc = (doc: any) => {
    if (!doc) return;

    setSelectedDoc(doc);
    setViewModalVisible(true);

    if (doc.id && decryptionCacheRef.current.has(doc.id)) {
      const cached = decryptionCacheRef.current.get(doc.id)!;
      setDecryptedText(cached.plainText);
      setDecryptedArray(cached.array);
      setIsOpeningDoc(false);
      return;
    }

    setDecryptedArray([]);
    setDecryptedText('');
    setIsOpeningDoc(true);

    setTimeout(async () => {
      try {
        const plainText = await loadPlainText(doc);
        setDecryptedText(plainText);
        rememberMeta(doc, parseDecryptedPayload(plainText));
        let prepared: string[] = [];
        const rawArr = parseDecryptedContent(plainText);
        if (rawArr.length > 0) {
          const effectiveType = doc.type === 'pdf' || (rawArr[0] && rawArr[0].includes('application/pdf')) ? 'pdf' : 'image';
          prepared = await prepareLocalFiles(rawArr, doc.title || 'doc', effectiveType, doc.id);
          setDecryptedArray(prepared);
        }
        if (doc.id && !plainText.startsWith('⚠️')) {
          decryptionCacheRef.current.set(doc.id, { plainText, array: prepared });
        }
      } catch (err) {
        console.warn('handleViewDoc error:', err);
      } finally {
        setIsOpeningDoc(false);
      }
    }, 10);
  };

  const handleSelectPreview = async (doc: any) => {
    if (!doc) return;
    const currentRequestId = ++previewRequestIdRef.current;
    setPreviewDoc(doc);

    if (doc.id && decryptionCacheRef.current.has(doc.id)) {
      const cached = decryptionCacheRef.current.get(doc.id)!;
      setPreviewData(cached.plainText);
      setPreviewDataArray(cached.array);
      setPreviewLoading(false);
      if (cached.array.length > 0) {
        const initialSelection: Record<number, boolean> = {};
        cached.array.forEach((_, idx) => { initialSelection[idx] = true; });
        setSelectedForDownload(initialSelection);
      } else {
        setSelectedForDownload({});
      }
      return;
    }

    // Immediately clear previous preview array and set loading to prevent cross-type rendering crash
    setPreviewLoading(true);
    setPreviewData('');
    setPreviewDataArray([]);
    setSelectedForDownload({});

    try {
      const plainText = await loadPlainText(doc);

      // Check if user already switched to another document
      if (previewRequestIdRef.current !== currentRequestId) return;

      setPreviewData(plainText);
      rememberMeta(doc, parseDecryptedPayload(plainText));

      let arr: string[] = [];
      const rawArr = parseDecryptedContent(plainText);
      if (rawArr.length > 0) {
        const effectiveType = doc.type === 'pdf' || (rawArr[0] && rawArr[0].includes('application/pdf')) ? 'pdf' : 'image';
        arr = await prepareLocalFiles(rawArr, doc.title || 'doc', effectiveType, doc.id);
      }

      // Check if user already switched to another document
      if (previewRequestIdRef.current !== currentRequestId) return;

      setPreviewDataArray(arr);

      if (arr.length > 0) {
        const initialSelection: Record<number, boolean> = {};
        arr.forEach((_, idx) => { initialSelection[idx] = true; });
        setSelectedForDownload(initialSelection);
      }

      if (doc.id && !plainText.startsWith('⚠️')) {
        decryptionCacheRef.current.set(doc.id, { plainText, array: arr });
      }
    } catch (err) {
      console.warn('handleSelectPreview error:', err);
    } finally {
      if (previewRequestIdRef.current === currentRequestId) {
        setPreviewLoading(false);
      }
    }
  };

  const getFileExtension = (type: string, dataUri: string = ''): string => {
    if (type === 'pdf' || dataUri.includes('application/pdf')) return 'pdf';
    if (type === 'image' || dataUri.startsWith('data:image/')) {
      if (dataUri.includes('data:image/png')) return 'png';
      if (dataUri.includes('data:image/gif')) return 'gif';
      return 'jpg';
    }
    if (type === 'doc' || type === 'docx' || dataUri.includes('wordprocessingml') || dataUri.includes('msword')) return 'docx';
    if (dataUri.includes('presentationml') || dataUri.includes('powerpoint')) return 'pptx';
    if (dataUri.includes('spreadsheetml') || dataUri.includes('excel')) return 'xlsx';
    return 'txt';
  };

  const handleDownloadFile = async (base64DataUri: string, title: string, type: string, index: number = 0) => {
    if (!base64DataUri) return;
    const ext = getFileExtension(type, base64DataUri);

    if (Platform.OS === 'web') {
      try {
        const res = await fetch(base64DataUri);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${title || 'file'}${index > 0 ? `_${index + 1}` : ''}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        Alert.alert('Error', 'Could not process file for download.');
      }
    } else {
      if (isSharingRef.current) return;
      isSharingRef.current = true;
      try {
        let targetUri = base64DataUri;
        if (base64DataUri.startsWith('data:')) {
          const base64Data = base64DataUri.includes(',') ? base64DataUri.split(',')[1] : base64DataUri;
          const safeTitle = (title || 'file').replace(/[^a-z0-9]/gi, '_');
          targetUri = `${await ensureDecryptedCacheDir()}${safeTitle}${index > 0 ? `_${index + 1}` : ''}.${ext}`;
          await FileSystem.writeAsStringAsync(targetUri, base64Data, { encoding: 'base64' });
        }
        await withoutAutoLock(() => Sharing.shareAsync(targetUri));
      } catch (error) {
        console.warn('Share error:', error);
      } finally {
        isSharingRef.current = false;
      }
    }
  };

  /**
   * Hands several files over one after another.
   *
   * On the web they are staggered so the browser does not treat the second
   * download as a blocked pop-up. On a phone each share sheet is waited for
   * instead: firing the next one while the last is still on screen loses it,
   * and a caller that needs to know when the sheet is up can now await this.
   */
  const shareFilesInTurn = async (uris: string[], title: string, type: string) => {
    for (let idx = 0; idx < uris.length; idx++) {
      if (Platform.OS === 'web' && idx > 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      await handleDownloadFile(uris[idx], title, type, idx);
    }
  };

  const handleDownloadFromCard = async (doc: any) => {
    const plainText = await loadPlainText(doc);
    const arr = parseDecryptedContent(plainText);
    await shareFilesInTurn(arr, doc.title, doc.type);
  };

  const handleDownloadSelected = async () => {
    if (!previewDoc) return;
    const chosen = previewDataArray.filter((_, idx) => selectedForDownload[idx]);

    if (chosen.length === 0) {
      Alert.alert('No files selected', 'Please select at least one file to download.');
      return;
    }
    await shareFilesInTurn(chosen, previewDoc.title, previewDoc.type);
  };

  /**
   * Pictures get a choice: the files as they are, or one PDF holding them.
   * Anything else has only one sensible form, so it goes straight out.
   */
  const handleShareItem = async (item: any) => {
    if (!item) return;
    try {
      const payload = parseDecryptedPayload(await loadPlainText(item));
      const files = payload.files || [];
      const isPictures = files.length > 0
        && (item.type === 'image' || files.every(f => f.startsWith('data:image')));
      if (isPictures) {
        setShareChoice({ doc: item, files });
        return;
      }
    } catch (e) {
      // Fall through and share it the ordinary way
    }
    handleDownloadItem(item);
  };

  /** Re-encodes each picture to JPEG, which is the form a PDF can hold directly. */
  const shareImagesAsPdf = async (doc: any, files: string[]) => {
    setIsBuildingPdf(true);
    try {
      const images: PdfImage[] = [];
      for (const uri of files) {
        const shot = await ImageManipulator.manipulateAsync(uri, [], {
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        });
        if (shot.base64) images.push({ base64: shot.base64, width: shot.width, height: shot.height });
      }
      const pdf = buildImagePdf(images);
      if (!pdf) {
        Alert.alert('Could not build the PDF', 'The pictures could not be read.');
        return;
      }
      const safeTitle = (doc?.title || 'document').replace(/[^a-z0-9]/gi, '_');

      if (Platform.OS === 'web') {
        // The browser has no share sheet to hand this to, so it downloads
        const bytes = Uint8Array.from(atob(pdf), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeTitle}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }

      const target = `${await ensureDecryptedCacheDir()}${safeTitle}.pdf`;
      await FileSystem.writeAsStringAsync(target, pdf, { encoding: 'base64' });
      await withoutAutoLock(() => Sharing.shareAsync(target, {
        mimeType: 'application/pdf',
        dialogTitle: doc?.title || 'Share as PDF',
        UTI: 'com.adobe.pdf',
      }));
    } catch (error) {
      console.warn('Share as PDF failed:', error);
      Alert.alert('Could not share', 'The PDF could not be created.');
    } finally {
      setIsBuildingPdf(false);
    }
  };

  const handleDownloadItem = async (item: any) => {
    if (!item) return;
    const plainText = await loadPlainText(item);
    const payload = parseDecryptedPayload(plainText);
    if (payload.files && payload.files.length > 0) {
      await shareFilesInTurn(payload.files, item.title, item.type);
    } else if (payload.notes && payload.notes.trim()) {
      const dataUri = `data:text/plain;charset=utf-8,${encodeURIComponent(payload.notes)}`;
      await handleDownloadFile(dataUri, item.title, 'text', 0);
    } else {
      Alert.alert('Download', 'No file attachments or text content to download.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={AppTheme.colors.primary} />
      </View>
    );
  }

  /**
   * The "check these dates" step, drawn over whichever editor asked for it
   * rather than in a window of its own. It is raised from inside an open
   * modal, and iOS presents one modal at a time - as a sibling it never
   * appeared there, so Save simply did nothing whenever a scan had filled in
   * a date.
   */
  const renderDateVerifyOverlay = (target: 'add' | 'edit') => {
    if (dateVerifyMode !== target) return null;
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 999998, elevation: 999998 }]}>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}>
          <View style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 24,
            maxWidth: 380,
            width: '100%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 8,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: '#fef3c7',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 12,
              }}>
                <Ionicons name="alert-circle-outline" size={22} color="#d97706" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: AppTheme.colors.text, flex: 1 }}>Verify Dates</Text>
              <ModalCloseButton onPress={() => setDateVerifyMode(null)} />
            </View>

            <Text style={{ fontSize: 14, color: AppTheme.colors.textSecondary, lineHeight: 20, marginBottom: 14 }}>
              Please check the file and confirm these dates are correct. You can still edit them later — open the document and tap Edit at any time, even after saving.
            </Text>

            <View style={{ backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ fontSize: 13, color: AppTheme.colors.textSecondary }}>Start Date</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: AppTheme.colors.text }}>
                  {toDisplayDate(dateVerifyMode === 'edit' ? editDocStartDate : docStartDate) || 'NA'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, color: AppTheme.colors.textSecondary }}>End Date</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: AppTheme.colors.text }}>
                  {toDisplayDate(dateVerifyMode === 'edit' ? editDocEndDate : docEndDate) || 'NA'}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity
                onPress={() => setDateVerifyMode(null)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 18,
                  borderRadius: 8,
                  backgroundColor: '#f1f5f9',
                  marginRight: 10,
                }}
              >
                <Text style={{ color: AppTheme.colors.text, fontWeight: '600', fontSize: 14 }}>Review</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const mode = dateVerifyMode;
                  setDateVerifyMode(null);
                  if (mode === 'edit') {
                    performSaveEditDoc();
                  } else {
                    performAddDocument();
                  }
                }}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 18,
                  borderRadius: 8,
                  backgroundColor: AppTheme.colors.primary,
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}>Confirm & Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const getIconForType = (type: string) => {
    if (type === 'image') return 'image';
    if (type === 'pdf') return 'document';
    return 'document-text';
  };

  const getPdfBlobUrl = (uri: string): string => {
    if (!uri) return '';
    if (uri.startsWith('blob:')) return uri;
    try {
      let base64 = uri;
      let mime = 'application/pdf';
      if (uri.startsWith('data:')) {
        const parts = uri.split(',');
        const header = parts[0];
        base64 = parts[1] || parts[0];
        const mimeMatch = header.match(/data:([^;]+)/);
        if (mimeMatch) mime = mimeMatch[1];
      }
      const cleanBase64 = base64.replace(/[\s\r\n]/g, '');
      const binary = atob(cleanBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error('getPdfBlobUrl error:', e);
      return uri;
    }
  };

  /** Reads the ciphertext length off the row, which no longer carries the bytes. */
  const contentBytes = (doc: any): number => {
    const length = typeof doc?.contentLength === 'number' ? doc.contentLength : (doc?.encryptedContent?.length || 0);
    return Math.round(length * 0.75);
  };

  const formatFileSize = (doc: any): string => {
    const bytes = contentBytes(doc);
    if (!bytes) return '0 KB';
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
  };

  const calculateTotalSizeMB = (): string => {
    let totalBytes = 0;
    activeDocuments.forEach(doc => {
      totalBytes += contentBytes(doc);
    });
    return (totalBytes / (1024 * 1024)).toFixed(1);
  };

  const renderWithTooltip = (element: React.ReactElement, tooltipText: string, display?: string, onDoubleClick?: () => void, flex?: number) => {
    if (Platform.OS === 'web' && tooltipText) {
      return React.createElement('div', { 
        title: tooltipText, 
        onDoubleClick: onDoubleClick,
        style: { 
          display: display === 'flex' ? 'flex' : (display || 'inline-flex'), 
          cursor: 'pointer', 
          maxWidth: '100%', 
          width: display === 'block' ? '100%' : undefined,
          flex: display === 'flex' ? 1 : (flex !== undefined ? flex : undefined),
          alignItems: display === 'block' ? undefined : 'center'
        } 
      }, element);
    }
    return element;
  };

  const handleItemPress = (item: any) => {
    const now = Date.now();
    const isDoubleTap = lastTapRef.current && lastTapRef.current.id === item.id && (now - lastTapRef.current.time) < 450;

    if (isDoubleTap) {
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }
      lastTapRef.current = null;
      handleViewDoc(item);
    } else {
      lastTapRef.current = { id: item.id, time: now };
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      if (previewDoc?.id === item.id) {
        return;
      }
      tapTimeoutRef.current = setTimeout(() => {
        handleSelectPreview(item);
        tapTimeoutRef.current = null;
      }, 50);
    }
  };

  const handleRightPanePress = (doc: any) => {
    if (!doc) return;
    const now = Date.now();
    if (rightPaneTapRef.current && rightPaneTapRef.current.id === doc.id && (now - rightPaneTapRef.current.time) < 500) {
      rightPaneTapRef.current = null;
      handleViewDoc(doc);
    } else {
      rightPaneTapRef.current = { id: doc.id, time: now };
    }
  };

  const handleDeleteClick = (item: any) => {
    if (!item) return;
    if (Platform.OS === 'web') {
      // Use custom in-app modal for web (window.confirm can be blocked)
      setDeleteConfirmDoc(item);
    } else {
      Alert.alert('Delete Document', `Are you sure you want to delete "${item.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          if (item.id) decryptionCacheRef.current.delete(item.id);
          deleteDocument(item.id!, tabId);
          if (previewDoc?.id === item.id) {
            setPreviewDoc(null);
            setPreviewData('');
            setPreviewDataArray([]);
          }
        }}
      ]);
    }
  };

  const confirmDelete = () => {
    if (!deleteConfirmDoc) return;
    if (deleteConfirmDoc.id) decryptionCacheRef.current.delete(deleteConfirmDoc.id);
    deleteDocument(deleteConfirmDoc.id!, tabId);
    if (previewDoc?.id === deleteConfirmDoc.id) {
      setPreviewDoc(null);
      setPreviewData('');
      setPreviewDataArray([]);
    }
    setDeleteConfirmDoc(null);
  };

  const currentTab = (tabs || []).find(t => t.uuid === tabId);
  const displayTabName = route?.params?.tabName || currentTab?.name || 'General Vault';
  const displayTabDesc = currentTab?.description || 'Default secure storage tab';

  return (
    <View style={styles.container}>
      {/* VAULT TITLE & COUNTER HEADER */}
      <View style={{ 
        paddingHorizontal: isMobile ? 16 : 24, 
        paddingTop: isMobile ? Math.max(insets.top + 8, 16) : 16, 
        paddingBottom: 16,
        // This screen draws its own header, so it takes the bar colour as well
        backgroundColor: AppTheme.colors.bar,
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            style={{
              marginRight: 12,
              padding: 6,
            }}
          >
            <Ionicons name="chevron-back" size={24} color={AppTheme.colors.text} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: isMobile ? 20 : 24, fontWeight: '700', color: AppTheme.colors.text, letterSpacing: -0.3 }}>
              {displayTabName}
            </Text>
            <Text style={{ fontSize: 14, color: AppTheme.colors.textSecondary, marginTop: 2 }}>
              {displayTabDesc}
            </Text>
            <View style={{ 
              alignSelf: 'flex-start', 
              backgroundColor: AppTheme.colors.primaryLight, 
              paddingHorizontal: 12, 
              paddingVertical: 4, 
              borderRadius: 16, 
              marginTop: 8 
            }}>
              <Text style={{ color: AppTheme.colors.primary, fontSize: 12, fontWeight: '600' }}>
                {activeDocuments.length} {activeDocuments.length === 1 ? 'item' : 'items'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* MAIN SPLIT CONTENT CARD (Left List + Right Preview) */}
      <View style={{ flex: 1, paddingHorizontal: isMobile ? 10 : 24, paddingBottom: 20 }}>
        <View style={{
          flex: 1,
          flexDirection: 'row',
          backgroundColor: '#ffffff',
          borderRadius: 20,
          borderWidth: 1,
          borderColor: '#f1f5f9',
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.03,
          shadowRadius: 12,
          elevation: 3,
        }}>

          {/* LEFT PANE: List of Documents ("All Files") */}
          <View style={{
            width: isMobile ? '52%' : '35%',
            borderRightWidth: 1,
            borderColor: '#e2e8f0',
            backgroundColor: '#ffffff',
            flexDirection: 'column',
          }}>
            <View style={{
              paddingHorizontal: isMobile ? 8 : 6,
              paddingVertical: isMobile ? 8 : 6,
              borderBottomWidth: 1,
              borderColor: '#e2e8f0',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <TouchableOpacity
                onPress={() => setSortModalVisible(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: AppTheme.colors.primaryLight,
                  paddingHorizontal: isMobile ? 9 : 7,
                  paddingVertical: isMobile ? 5 : 3,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: AppTheme.colors.primaryBorder,
                  maxWidth: '92%',
                }}
                {...(Platform.OS === 'web' ? { title: 'Sort files' } : {})}
              >
                <Ionicons name="swap-vertical" size={isMobile ? 11 : 10} color={AppTheme.colors.primary} style={{ marginRight: 2 }} />
                <Text style={{ fontSize: isMobile ? 10 : 9, fontWeight: '600', color: AppTheme.colors.primary }} numberOfLines={1}>
                  {getDocSortLabel(sortOption)}
                </Text>
                <Ionicons name="chevron-down" size={isMobile ? 10 : 9} color={AppTheme.colors.primary} style={{ marginLeft: 2 }} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={sortedDocuments}
              keyExtractor={item => item.id!.toString()}
              // Windowing: without these a vault of a few hundred documents
              // builds every row up front, on the thread drawing the screen
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              updateCellsBatchingPeriod={50}
              windowSize={7}
              contentContainerStyle={{ padding: isMobile ? 9 : 8 }}
              renderItem={({ item }) => {
                const isSelected = previewDoc?.id === item.id;
                const formattedDate = new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                const expiry = item.id != null ? expiryByDocId.get(item.id) : undefined;
                const expiryStyle = expiry ? EXPIRY_STYLES[expiry.status] : null;
                
                const isPdf = item.type === 'pdf' || (item.title && item.title.toLowerCase().endsWith('.pdf'));
                const isImage = item.type === 'image' || (item.title && /\.(jpg|jpeg|png|webp|gif)$/i.test(item.title));
                
                let typeLabel = 'FILE';
                if (isPdf) typeLabel = 'PDF';
                else if (isImage) {
                  const ext = item.title?.split('.').pop()?.toUpperCase();
                  typeLabel = ext && ['JPG', 'JPEG', 'PNG', 'WEBP'].includes(ext) ? (ext === 'JPEG' ? 'JPG' : ext) : 'JPG';
                } else if (item.type === 'doc' || item.type === 'docx') {
                  typeLabel = 'DOC';
                }

                const cardContent = (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => handleItemPress(item)}
                    {...(Platform.OS === 'web' ? { onDoubleClick: () => handleViewDoc(item) } : {})}
                    style={{
                      backgroundColor: isSelected
                        ? AppTheme.colors.primaryLight
                        : (expiryStyle ? expiryStyle.background : '#ffffff'),
                      paddingVertical: isMobile ? 9 : 8,
                      paddingHorizontal: isMobile ? 7 : 8,
                      borderRadius: isMobile ? 12 : 12,
                      marginBottom: isMobile ? 8 : 8,
                      // Expiry shows through the background tint alone; the border
                      // is reserved for marking the selected row
                      borderWidth: isSelected ? 2 : 1,
                      borderColor: isSelected ? AppTheme.colors.primaryBorder : '#e2e8f0',
                      flexDirection: 'row',
                      alignItems: 'center',
                      width: '100%',
                    }}
                  >
                    {/* Left File Type Icon Box (Compact) */}
                    <View style={{ marginRight: isMobile ? 7 : 8 }}>
                      {isPdf ? (
                        <View style={{
                          width: isMobile ? 27 : 30,
                          height: isMobile ? 31 : 34,
                          borderRadius: 6,
                          backgroundColor: '#ffffff',
                          borderWidth: 1,
                          borderColor: '#e2e8f0',
                          alignItems: 'center',
                          justifyContent: 'center',
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.06,
                          shadowRadius: 2,
                          elevation: 1,
                        }}>
                          <View style={{
                            backgroundColor: '#ef4444',
                            paddingHorizontal: 3,
                            paddingVertical: 1,
                            borderRadius: 2.5,
                          }}>
                            <Text style={{ color: '#ffffff', fontSize: 7.5, fontWeight: '800', letterSpacing: 0.5 }}>PDF</Text>
                          </View>
                        </View>
                      ) : isImage ? (
                        <View style={{
                          width: isMobile ? 27 : 30,
                          height: isMobile ? 31 : 34,
                          borderRadius: 6,
                          backgroundColor: AppTheme.colors.primaryLight,
                          borderWidth: 1,
                          borderColor: AppTheme.colors.primaryBorder,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <Ionicons name="image" size={isMobile ? 16 : 17} color={AppTheme.colors.primary} />
                        </View>
                      ) : (
                        <View style={{
                          width: isMobile ? 27 : 30,
                          height: isMobile ? 31 : 34,
                          borderRadius: 6,
                          backgroundColor: '#f1f5f9',
                          borderWidth: 1,
                          borderColor: '#e2e8f0',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <Ionicons name="document-text" size={isMobile ? 16 : 17} color="#64748b" />
                        </View>
                      )}
                    </View>

                    {/* Middle: Title & Metadata subtitle */}
                    <View style={{ flex: 1, marginRight: isMobile ? 2 : 4 }}>
                      <Text
                        style={{
                          fontSize: isMobile ? 12 : 12.5,
                          fontWeight: '700',
                          color: '#0f172a',
                          lineHeight: isMobile ? 15.5 : 17,
                        }}
                        numberOfLines={isMobile ? 3 : 2}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={{
                          fontSize: 9.5,
                          color: '#64748b',
                          marginTop: 2,
                          fontWeight: '500',
                          lineHeight: 13,
                        }}
                        numberOfLines={isMobile ? 2 : 1}
                      >
                        {typeLabel} • {formatFileSize(item)} • {formattedDate}
                      </Text>
                      {expiry && expiryStyle && (
                        <Text
                          style={{
                            fontSize: 9.5,
                            marginTop: 2,
                            fontWeight: '800',
                            lineHeight: 13,
                            color: expiryStyle.text,
                          }}
                          numberOfLines={1}
                        >
                          {expiryLabel(expiry.status, expiry.days)}
                        </Text>
                      )}
                    </View>

                    {/* Right: Three Dots Action Menu Trigger */}
                    <TouchableOpacity
                      onPress={() => handleOpenEditDoc(item)}
                      style={{ padding: 2 }}
                    >
                      <Ionicons name="ellipsis-vertical" size={isMobile ? 14 : 15} color="#94a3b8" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );

                return renderWithTooltip(
                  cardContent,
                  `${item.title} (${formatFileSize(item)} • ${formattedDate})`,
                  'block',
                  () => handleViewDoc(item)
                );
              }}
              ListEmptyComponent={
                <View style={{ paddingVertical: isMobile ? 24 : 32, paddingHorizontal: isMobile ? 10 : 20, alignItems: 'center' }}>
                  <View style={{
                    width: isMobile ? 42 : 52,
                    height: isMobile ? 42 : 52,
                    borderRadius: isMobile ? 12 : 14,
                    backgroundColor: '#f1f5f9',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 10,
                  }}>
                    <Ionicons name="folder-open-outline" size={isMobile ? 22 : 26} color="#94a3b8" />
                  </View>
                  <Text style={{ color: AppTheme.colors.text, fontSize: isMobile ? 12 : 13.5, fontWeight: '700', textAlign: 'center' }}>
                    No files yet
                  </Text>
                  <Text style={{ color: AppTheme.colors.textSecondary, fontSize: isMobile ? 10.5 : 12, textAlign: 'center', marginTop: 5, lineHeight: isMobile ? 14.5 : 17 }}>
                    The added file names will be listed here.
                  </Text>
                </View>
              }
            />

            <View style={{ padding: 10, borderTopWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}>
              <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary, textAlign: 'center' }}>
                {activeDocuments.length} items · {calculateTotalSizeMB()} MB
              </Text>
            </View>
          </View>

          {/* RIGHT PANE: File Preview & Details */}
          <View style={{ width: isMobile ? '48%' : '65%', backgroundColor: '#ffffff', padding: isMobile ? 10 : 20 }}>
            {previewDoc ? (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {/* PREVIEW TOP ACTIONS TOOLBAR (Full Width across Right Pane) */}
                {/* Icons only: the labels said what the icons already show, and
                    dropping them leaves room for the icons to be read at a glance */}
                <View style={{ flexDirection: 'row', width: '100%', alignItems: 'center', gap: isMobile ? 5 : 12, marginBottom: 14 }}>
                  {[
                    { key: 'open', icon: 'eye-outline' as const, label: 'Open', onPress: () => handleViewDoc(previewDoc), danger: false },
                    // Sharing is what this actually does on the device, so it says so
                    { key: 'share', icon: 'share-social-outline' as const, label: 'Share', onPress: () => handleShareItem(previewDoc), danger: false },
                    { key: 'edit', icon: 'create-outline' as const, label: 'Edit', onPress: () => handleOpenEditDoc(previewDoc), danger: false },
                    { key: 'delete', icon: 'trash-outline' as const, label: 'Delete', onPress: () => handleDeleteClick(previewDoc), danger: true },
                  ].map(action => (
                    // The web tooltip wraps this in a div of its own, so the key
                    // belongs on a fragment rather than on the button inside it
                    <React.Fragment key={action.key}>{renderWithTooltip(
                    <TouchableOpacity
                      onPress={action.onPress}
                      accessibilityLabel={`${action.label} ${previewDoc.title}`}
                      style={{
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: action.danger ? '#fef2f2' : AppTheme.colors.primaryLight,
                        borderWidth: 1,
                        borderColor: action.danger ? '#fecaca' : AppTheme.colors.primaryBorder,
                        paddingHorizontal: isMobile ? 2 : 12,
                        paddingVertical: isMobile ? 7 : 10,
                        borderRadius: 10,
                        minHeight: isMobile ? 44 : 42,
                      }}
                    >
                      <Ionicons
                        name={action.icon}
                        size={isMobile ? 20 : 22}
                        color={action.danger ? AppTheme.colors.error : AppTheme.colors.primary}
                      />
                    </TouchableOpacity>,
                    `${action.label} ${previewDoc.title}`,
                    'flex'
                  )}</React.Fragment>
                  ))}
                </View>

                {/* MAIN PREVIEW CANVAS */}
                <View style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  minHeight: isMobile ? 210 : 360,
                  justifyContent: 'center',
                }}>
                  {previewLoading ? (
                    <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center', minHeight: isMobile ? 210 : 360 }}>
                      <ActivityIndicator size="large" color={AppTheme.colors.primary} />
                      <Text style={{ marginTop: 12, fontSize: 13, color: AppTheme.colors.textSecondary, fontWeight: '500' }}>
                        Loading preview...
                      </Text>
                    </View>
                  ) : (
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                      {(() => {
                        const payload = parseDecryptedPayload(previewData);
                        const notesText = payload.notes || (!previewData.startsWith('[') && !previewData.startsWith('{') && !previewData.startsWith('⚠️') ? previewData : '');
                        
                        return (
                          <>
                            {previewData.startsWith('⚠️') ? (
                              <View style={{ backgroundColor: '#fef2f2', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#fecaca', alignItems: 'center', marginVertical: 8 }}>
                                <Ionicons name="lock-closed-outline" size={32} color="#dc2626" style={{ marginBottom: 8 }} />
                                <Text style={{ color: '#991b1b', fontSize: 14, fontWeight: '600', textAlign: 'center' }}>
                                  Decryption Failed
                                </Text>
                                <Text style={{ color: '#b91c1c', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                                  Unable to decrypt document with the current keys.
                                </Text>
                              </View>
                            ) : previewDataArray.length === 0 && notesText ? (
                              <View style={{ backgroundColor: '#ffffff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' }}>
                                <Text style={{ color: AppTheme.colors.text, fontSize: 15, lineHeight: 24 }}>
                                  {notesText}
                                </Text>
                              </View>
                            ) : null}

                            {/* Render File Attachments (Images, PDFs, Word Docs, etc.) */}
                            {previewDataArray.map((uri, idx) => {
                              const isPdfUri = uri.includes('application/pdf') || uri.toLowerCase().endsWith('.pdf');
                              const isImgUri = uri.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif)$/i.test(uri);
                              const isImg = isImgUri || (!isPdfUri && previewDoc.type === 'image');
                              const isPdfFile = isPdfUri || (!isImgUri && previewDoc.type === 'pdf');
                              const isWordFile = uri.includes('wordprocessingml') || uri.includes('msword') || previewDoc.type === 'doc' || previewDoc.type === 'docx';

                              if (isImg) {
                                const safeUri = getSafeImageUri(uri);
                                if (!safeUri) return null;
                                return (
                                  <TouchableOpacity
                                    key={idx}
                                    activeOpacity={0.9}
                                    onPress={() => handleRightPanePress(previewDoc)}
                                    {...(Platform.OS === 'web' ? { onDoubleClick: () => handleViewDoc(previewDoc) } : {})}
                                    style={{ marginBottom: 12, alignItems: 'center' }}
                                  >
                                    <Image
                                      source={{ uri: safeUri }}
                                      style={{ width: '100%', height: isMobile ? 190 : 380, borderRadius: 12 }}
                                      resizeMode="contain"
                                    />
                                  </TouchableOpacity>
                                );
                              }

                              if (isPdfFile && Platform.OS === 'web') {
                                const blobUrl = getPdfBlobUrl(uri);
                                return (
                                  <TouchableOpacity
                                    key={idx}
                                    activeOpacity={0.95}
                                    onPress={() => handleRightPanePress(previewDoc)}
                                    {...(Platform.OS === 'web' ? { onDoubleClick: () => handleViewDoc(previewDoc) } : {})}
                                    style={{ marginBottom: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#ffffff' }}
                                  >
                                    <View style={{ position: 'relative', width: '100%', height: isMobile ? 260 : 500 }}>
                                      {React.createElement('div', {
                                        style: { width: '100%', height: '100%', backgroundColor: '#ffffff', pointerEvents: 'none' },
                                      }, React.createElement('iframe', {
                                        src: blobUrl,
                                        style: { width: '100%', height: '100%', border: 'none', pointerEvents: 'none' },
                                        title: `PDF Document ${idx + 1}`,
                                      }))}
                                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
                                    </View>
                                  </TouchableOpacity>
                                );
                              }

                              if (isPdfFile && Platform.OS !== 'web') {
                                return (
                                  <TouchableOpacity
                                    key={idx}
                                    activeOpacity={0.95}
                                    onPress={() => handleRightPanePress(previewDoc)}
                                    style={{ marginBottom: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#ffffff' }}
                                  >
                                    <View style={{ height: isMobile ? 250 : 480, position: 'relative' }}>
                                      <PdfViewer 
                                        uri={uri} 
                                        style={{ flex: 1 }} 
                                        pointerEvents="none" 
                                        singlePageOnly={true}
                                      />
                                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
                                    </View>
                                  </TouchableOpacity>
                                );
                              }

                              // Word Document / Generic File Attachment Card Banner
                            return (
                              <View key={idx} style={{
                                marginBottom: 14,
                                padding: 16,
                                borderRadius: 14,
                                backgroundColor: '#ffffff',
                                borderWidth: 1,
                                borderColor: '#cbd5e1',
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                              }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 }}>
                                  <View style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: 12,
                                    backgroundColor: AppTheme.colors.primaryLight,
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    marginRight: 12,
                                  }}>
                                    <Ionicons name="document-text" size={28} color={AppTheme.colors.primary} />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.text }} numberOfLines={1}>
                                      {previewDoc.title} {previewDataArray.length > 1 ? `(${idx + 1})` : ''}
                                    </Text>
                                    <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, marginTop: 2 }}>
                                      {isWordFile ? 'Microsoft Word Document (.docx)' : 'Attached Document File'}
                                    </Text>
                                  </View>
                                </View>

                                <TouchableOpacity
                                  onPress={() => handleDownloadFile(uri, previewDoc.title, isWordFile ? 'docx' : 'file', idx)}
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    backgroundColor: AppTheme.colors.primary,
                                    paddingHorizontal: 14,
                                    paddingVertical: 8,
                                    borderRadius: 8,
                                  }}
                                >
                                  <Ionicons name="download-outline" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                                  <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 13 }}>Save</Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </>
                      );
                    })()}
                    </ScrollView>
                  )}
                </View>

                {/* DETAILS SECTION UNDERNEATH PREVIEW */}
                <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderColor: '#e2e8f0' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: AppTheme.colors.text, marginBottom: 12 }}>
                    Details
                  </Text>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <TouchableOpacity 
                      activeOpacity={0.7}
                      onPress={() => handleRightPanePress(previewDoc)}
                      {...(Platform.OS === 'web' ? { onDoubleClick: () => handleViewDoc(previewDoc) } : {})}
                      style={{ width: '100%', marginBottom: 14 }}
                    >
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>File Name</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }} numberOfLines={2}>
                        {previewDoc.title}
                      </Text>
                    </TouchableOpacity>

                    {/* VALIDITY DATES (main info) */}
                    {(() => {
                      const payload = parseDecryptedPayload(previewData);
                      const detected = extractDatesFromText(`${previewDoc.title || ''}\n${payload.notes}`);
                      const startDate = payload.startDate || detected.startDate || 'NA';
                      const endDate = payload.endDate || detected.endDate || 'NA';
                      const expiry = getExpiryStatus(endDate);
                      const expiryStyle = expiry ? EXPIRY_STYLES[expiry.status] : null;
                      const labelColor = expiryStyle ? expiryStyle.text : AppTheme.colors.primary;
                      const number = payload.number || extractDocumentNumber(`${previewDoc.title || ''}
${payload.notes}`);
                      return (
                        <>
                        {/* Document number sits above the validity dates */}
                        <View style={{
                          width: '100%',
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: AppTheme.colors.primaryLight,
                          borderWidth: 1,
                          borderColor: AppTheme.colors.primaryBorder,
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginBottom: 10,
                        }}>
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <Text style={{ fontSize: 11, color: AppTheme.colors.primary, fontWeight: '600' }}>Number</Text>
                            {/* A card number is too long for this column on one line,
                                and half a number is no use to anyone reading it, so it
                                is left free to wrap rather than capped and clipped */}
                            <Text style={{ fontSize: 13, fontWeight: '700', color: AppTheme.colors.text, marginTop: 2 }}>
                              {number || 'NA'}
                            </Text>
                          </View>
                          {!!number && (
                            <TouchableOpacity
                              onPress={() => handleCopyNumber(number)}
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 8,
                                borderWidth: 1,
                                borderColor: AppTheme.colors.primaryBorder,
                                backgroundColor: '#ffffff',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              activeOpacity={0.7}
                            >
                              <Ionicons
                                name={copiedNumber === number ? 'checkmark' : 'copy-outline'}
                                size={16}
                                color={copiedNumber === number ? '#15803d' : AppTheme.colors.primary}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={{
                          width: '100%',
                          backgroundColor: expiryStyle ? expiryStyle.background : AppTheme.colors.primaryLight,
                          borderWidth: expiryStyle ? 2 : 1,
                          borderColor: expiryStyle ? expiryStyle.border : AppTheme.colors.primaryBorder,
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginBottom: 14,
                        }}>
                          <View style={{ flexDirection: isMobile ? 'column' : 'row' }}>
                            <View style={{ flex: isMobile ? undefined : 1, marginBottom: isMobile ? 8 : 0 }}>
                              <Text style={{ fontSize: 11, color: labelColor, fontWeight: '600' }}>Start Date</Text>
                              {/* The about-to-expire highlight belongs to the
                                  validity dates alone - on the file name it
                                  drew the eye to the wrong thing */}
                              <Text style={{
                                fontSize: 13,
                                fontWeight: '700',
                                color: AppTheme.colors.text,
                                marginTop: 2,
                                backgroundColor: expiryStyle?.highlight,
                                alignSelf: 'flex-start',
                              }} numberOfLines={1}>
                                {toDisplayDate(startDate)}
                              </Text>
                            </View>
                            <View style={{ flex: isMobile ? undefined : 1 }}>
                              <Text style={{ fontSize: 11, color: labelColor, fontWeight: '600' }}>End Date</Text>
                              <Text style={{
                                fontSize: 13,
                                fontWeight: '700',
                                color: AppTheme.colors.text,
                                marginTop: 2,
                                backgroundColor: expiryStyle?.highlight,
                                alignSelf: 'flex-start',
                              }} numberOfLines={1}>
                                {toDisplayDate(endDate)}
                              </Text>
                            </View>
                          </View>
                          {expiry && expiryStyle && (
                            <View style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              marginTop: 10,
                              paddingTop: 8,
                              borderTopWidth: 1,
                              borderColor: expiryStyle.border,
                            }}>
                              <Ionicons
                                name={expiry.status === 'safe' ? 'checkmark-circle' : expiry.status === 'expiring' ? 'alert-circle' : 'close-circle'}
                                size={15}
                                color={expiryStyle.text}
                                style={{ marginRight: 6 }}
                              />
                              <Text style={{ fontSize: 12, fontWeight: '800', color: expiryStyle.text }}>
                                {expiryLabel(expiry.status, expiry.days)}
                              </Text>
                            </View>
                          )}
                        </View>
                        </>
                      );
                    })()}

                    <View style={{ width: isMobile ? '100%' : '50%', marginBottom: isMobile ? 12 : 14 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Type</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }}>
                        {previewDoc.type === 'image' ? 'JPEG Image' : previewDoc.type === 'pdf' ? 'PDF Document' : 'Text Document'}
                      </Text>
                    </View>

                    <View style={{ width: isMobile ? '100%' : '50%', marginBottom: isMobile ? 12 : 14 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Size</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }}>
                        {formatFileSize(previewDoc)}
                      </Text>
                    </View>

                    <View style={{ width: isMobile ? '100%' : '50%', marginBottom: isMobile ? 12 : 10 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Date Modified</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }}>
                        {new Date(previewDoc.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>

                    <View style={{ width: isMobile ? '100%' : '50%', marginBottom: isMobile ? 12 : 10 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Path</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }} numberOfLines={1}>
                        /{displayTabName}/{previewDoc.title}
                      </Text>
                    </View>

                    {(() => {
                      const payload = parseDecryptedPayload(previewData);
                      const notesText = payload.notes || (!previewData.startsWith('[') && !previewData.startsWith('{') && !previewData.startsWith('⚠️') ? previewData : '');
                      if (!notesText) return null;
                      return (
                        <View style={{ width: '100%', marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderColor: '#f1f5f9' }}>
                          <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary, marginBottom: 6 }}>Description / Notes</Text>
                          <View style={{ backgroundColor: '#f8fafc', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
                            <Text style={{ fontSize: 13, color: AppTheme.colors.text, lineHeight: 20 }}>
                              {notesText}
                            </Text>
                          </View>
                        </View>
                      );
                    })()}
                  </View>
                </View>
              </ScrollView>
            ) : (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {/* PREVIEW AREA PLACEHOLDER */}
                <View style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  borderStyle: 'dashed',
                  minHeight: isMobile ? 300 : 440,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: isMobile ? 12 : 24,
                  paddingVertical: 20,
                }}>
                  <Ionicons name="document-text-outline" size={isMobile ? 34 : 64} color={AppTheme.colors.border} />
                  <Text style={{
                    color: AppTheme.colors.textSecondary,
                    marginTop: isMobile ? 10 : 16,
                    fontSize: isMobile ? 11 : 15,
                    fontWeight: '500',
                    textAlign: 'center',
                    lineHeight: isMobile ? 15 : 21,
                  }}>
                    The preview of the selected file will be shown here.
                  </Text>
                </View>

                {/* DETAILS AREA PLACEHOLDER */}
                <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderColor: '#e2e8f0' }}>
                  <Text style={{ fontSize: isMobile ? 13 : 15, fontWeight: '700', color: AppTheme.colors.text, marginBottom: 10 }}>
                    Details
                  </Text>
                  <View style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#e2e8f0',
                    borderStyle: 'dashed',
                    paddingHorizontal: isMobile ? 12 : 20,
                    paddingVertical: isMobile ? 16 : 22,
                    alignItems: 'center',
                  }}>
                    <Ionicons name="information-circle-outline" size={isMobile ? 20 : 26} color={AppTheme.colors.border} />
                    <Text style={{
                      color: AppTheme.colors.textSecondary,
                      marginTop: 6,
                      fontSize: isMobile ? 10.5 : 13,
                      textAlign: 'center',
                      lineHeight: isMobile ? 14.5 : 18,
                    }}>
                      The details of the selected file will be shown here.
                    </Text>
                  </View>
                </View>
              </ScrollView>
            )}
          </View>

        </View>
      </View>

      {/* HOW TO SHARE A PICTURE */}
      <Modal
        visible={!!shareChoice}
        transparent
        animationType="fade"
        onRequestClose={() => !isBuildingPdf && setShareChoice(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView contentContainerStyle={{ paddingBottom: 2 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]} numberOfLines={2}>Share {shareChoice?.doc?.title || 'document'}</Text>
              <ModalCloseButton onPress={() => !isBuildingPdf && setShareChoice(null)} />
            </View>
            <Text style={{ fontSize: 12.5, color: AppTheme.colors.textSecondary, marginTop: 4, marginBottom: 16 }}>
              {shareChoice && shareChoice.files.length > 1
                ? `${shareChoice.files.length} pictures. A PDF sends them as one file.`
                : 'Send the picture as it is, or wrapped in a PDF.'}
            </Text>

            {[
              {
                key: 'image',
                icon: 'image-outline' as const,
                title: shareChoice && shareChoice.files.length > 1 ? 'The pictures' : 'The picture',
                subtitle: 'Shared exactly as stored',
                // The window stays up until the share sheet has been handed
                // over: on iOS, presenting one while a modal is still
                // animating away is how a share silently does nothing
                onPress: async () => {
                  const doc = shareChoice?.doc;
                  if (doc) await handleDownloadItem(doc);
                  setShareChoice(null);
                },
              },
              {
                key: 'pdf',
                icon: 'document-text-outline' as const,
                title: 'A PDF',
                subtitle: 'One page per picture',
                onPress: async () => {
                  const current = shareChoice;
                  if (current) await shareImagesAsPdf(current.doc, current.files);
                  setShareChoice(null);
                },
              },
            ].map(option => (
              <TouchableOpacity
                key={option.key}
                onPress={option.onPress}
                disabled={isBuildingPdf}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 13,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: AppTheme.colors.border,
                  backgroundColor: AppTheme.colors.surfaceSubtle,
                  marginBottom: 10,
                }}
              >
                <View style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: AppTheme.colors.primaryLight,
                  marginRight: 11,
                }}>
                  <Ionicons name={option.icon} size={18} color={AppTheme.colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.text }}>{option.title}</Text>
                  <Text style={{ fontSize: 11.5, color: AppTheme.colors.textSecondary, marginTop: 2 }}>{option.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={AppTheme.colors.textMuted} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={() => setShareChoice(null)} style={{ paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: AppTheme.colors.surfaceSubtle, borderWidth: 1, borderColor: AppTheme.colors.border }}>
              <Text style={{ color: AppTheme.colors.primary, fontWeight: '700', fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </View>

        {/* Drawn over this window rather than in one of its own, for the same
            reason: iOS presents a single modal at a time */}
        {isBuildingPdf && (
          <View style={[StyleSheet.absoluteFill, styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
            <View style={{ backgroundColor: '#ffffff', borderRadius: 16, padding: 24, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={AppTheme.colors.primary} />
              <Text style={{ marginTop: 12, color: AppTheme.colors.textSecondary, fontSize: 13 }}>
                Building the PDF…
              </Text>
            </View>
          </View>
        )}
      </Modal>

      <DraggableFAB onPress={() => setModalVisible(true)} />

      {rasterTarget ? (
        <PdfRasterizer
          base64={rasterTarget.base64}
          fileUri={rasterTarget.fileUri}
          onResult={(image) => rasterResolveRef.current?.(image)}
        />
      ) : null}

      {/* ADD DOCUMENT MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]}>Add Secure Document</Text>
              <ModalCloseButton onPress={closeAddDocument} />
            </View>

            <TextInput
              style={[styles.input, { letterSpacing: 0 }]}
              placeholder="Title"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={docTitle}
              onChangeText={(text) => {
                setDocTitle(text);
                if (!docDatesEdited) {
                  const detected = extractDatesFromText(`${text}\n${docContent}`);
                  // Only ever fill in what was found. Overwriting unconditionally
                  // would wipe dates the OCR scan already recovered from the file.
                  if (detected.startDate || detected.endDate) {
                    setDocStartDate(detected.startDate);
                    setDocEndDate(detected.endDate);
                    setDocHasExpiry(true);
                  }
                  const foundNumber = extractDocumentNumber(`${text}\n${docContent}`);
                  if (foundNumber && !docNumber.trim()) setDocNumber(foundNumber);
                }
              }}
            />

            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top', letterSpacing: 0 }]}
              placeholder="Description / Notes"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={docContent}
              onChangeText={(text) => {
                setDocContent(text);
                if (!docDatesEdited) {
                  const detected = extractDatesFromText(`${docTitle}\n${text}`);
                  // Only ever fill in what was found. Overwriting unconditionally
                  // would wipe dates the OCR scan already recovered from the file.
                  if (detected.startDate || detected.endDate) {
                    setDocStartDate(detected.startDate);
                    setDocEndDate(detected.endDate);
                    setDocHasExpiry(true);
                  }
                  const foundNumber = extractDocumentNumber(`${docTitle}\n${text}`);
                  if (foundNumber && !docNumber.trim()) setDocNumber(foundNumber);
                }
              }}
              multiline
            />


            {/* DOCUMENT NUMBER — passport no, card no, policy no and so on */}
            <Text style={styles.fieldLabel}>Number</Text>
            <View style={styles.numberRow}>
              <TextInput
                style={[styles.input, styles.numberInput]}
                placeholder="Passport / card / policy number"
                placeholderTextColor={AppTheme.colors.textSecondary}
                value={docNumber}
                onChangeText={(text) => { setDocNumber(text); setDocDatesEdited(true); }}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                onPress={() => handleCopyNumber(docNumber)}
                style={[styles.copyButton, !docNumber.trim() && styles.copyButtonDisabled]}
                disabled={!docNumber.trim()}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={18} color={docNumber.trim() ? AppTheme.colors.primary : '#cbd5e1'} />
              </TouchableOpacity>
            </View>
            {!!docNumber.trim() && copiedNumber === docNumber.trim() && (
              <Text style={styles.copiedBadge}>Copied to clipboard</Text>
            )}
            <TouchableOpacity
              onPress={() => setDocHasExpiry(!docHasExpiry)}
              style={styles.checkboxRow}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, docHasExpiry && styles.checkboxChecked]}>
                {docHasExpiry && <Ionicons name="checkmark" size={14} color="#ffffff" />}
              </View>
              <Text style={styles.checkboxLabel}>Has expiry?</Text>
              {isScanningDates && (
                <View style={styles.scanningBadge}>
                  <ActivityIndicator size="small" color={AppTheme.colors.primary} />
                  <Text style={styles.scanningText}>Reading dates…</Text>
                </View>
              )}
            </TouchableOpacity>

            {!isScanningDates && dateScanStatus === 'none' && !docHasExpiry && (
              <Text style={styles.dateHint}>
                No dates could be read from this document — tick "Has expiry?" to enter them yourself.
              </Text>
            )}

            {!isScanningDates && dateScanStatus === 'unavailable' && !docHasExpiry && (
              <Text style={styles.dateHint}>
                This build cannot read text from a scan or a photo, so the dates have to be
                typed in — tick "Has expiry?" to enter them.
              </Text>
            )}

            {docHasExpiry && (
              <>
                <View style={styles.dateRow}>
                  <View style={styles.dateField}>
                    <Text style={styles.dateLabel}>Start Date</Text>
                    <View style={styles.dateInputWrap}>
                      <TextInput
                        style={[styles.input, styles.dateInput]}
                        placeholder="DD-MM-YYYY"
                        placeholderTextColor={AppTheme.colors.textSecondary}
                        value={docStartDate}
                        onChangeText={(text) => { setDocDatesEdited(true); setDocStartDate(text); }}
                      />
                      <TouchableOpacity
                        onPress={() => setDatePickerTarget('add-start')}
                        style={styles.calendarBtn}
                        {...(Platform.OS === 'web' ? { title: 'Pick start date' } : {})}
                      >
                        <Ionicons name="calendar-outline" size={18} color={AppTheme.colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.dateField}>
                    <Text style={styles.dateLabel}>End Date</Text>
                    <View style={styles.dateInputWrap}>
                      <TextInput
                        style={[styles.input, styles.dateInput]}
                        placeholder="DD-MM-YYYY"
                        placeholderTextColor={AppTheme.colors.textSecondary}
                        value={docEndDate}
                        onChangeText={(text) => { setDocDatesEdited(true); setDocEndDate(text); }}
                      />
                      <TouchableOpacity
                        onPress={() => setDatePickerTarget('add-end')}
                        style={styles.calendarBtn}
                        {...(Platform.OS === 'web' ? { title: 'Pick end date' } : {})}
                      >
                        <Ionicons name="calendar-outline" size={18} color={AppTheme.colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                {!docDatesEdited && (docStartDate || docEndDate) ? (
                  <Text style={styles.dateHint}>
                    Dates were read from the document — check the file and confirm them. You can edit them later too.
                  </Text>
                ) : null}
              </>
            )}

            {fileUris.length > 0 && (
              <View style={styles.filePreviewContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10 }}>
                  {fileUris.map((uri, idx) => {
                    const safeUri = getSafeImageUri(uri);
                    return (
                      <View key={idx} style={styles.thumbnailWrapper}>
                        {fileType === 'image' && safeUri ? (
                          <Image source={{ uri: safeUri }} style={styles.thumbnailImage} />
                        ) : fileType === 'image' && !safeUri ? (
                          <View style={styles.thumbnailPdf}>
                            <Ionicons name="warning" size={48} color={AppTheme.colors.error} />
                            <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>Invalid Image</Text>
                          </View>
                        ) : (
                          <View style={styles.thumbnailPdf}>
                            <Ionicons name="document" size={48} color={AppTheme.colors.primary} />
                            <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>PDF {idx + 1}</Text>
                          </View>
                        )}
                        <TouchableOpacity
                          style={styles.removeFileBtn}
                          onPress={() => {
                            const newUris = [...fileUris];
                            newUris.splice(idx, 1);
                            setFileUris(newUris);
                            if (newUris.length === 0) setFileType(null);
                          }}
                          {...(Platform.OS === 'web' ? { title: 'Remove Attachment' } : {})}
                        >
                          <Ionicons name="close" size={16} color={AppTheme.colors.error} />
                        </TouchableOpacity>
                        {fileType === 'image' && safeUri && (
                          <TouchableOpacity
                            style={{
                              position: 'absolute',
                              bottom: -6,
                              left: -6,
                              backgroundColor: AppTheme.colors.primary,
                              borderRadius: 12,
                              padding: 4,
                              elevation: 3,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.2,
                              shadowRadius: 3,
                            }}
                            onPress={() => {
                              setCropTarget('add');
                              setCropIndex(idx);
                            }}
                            {...(Platform.OS === 'web' ? { title: 'Crop / Adjust Borders' } : {})}
                          >
                            <Ionicons name="crop" size={16} color="#fff" />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}

                  {/* Option to add more photos */}
                  {fileType === 'image' && (
                    <TouchableOpacity onPress={() => handleTakePhoto(false)} style={styles.addMoreTile}>
                      <Ionicons name="camera" size={32} color={AppTheme.colors.primary} />
                      <Text style={{ color: AppTheme.colors.primary, marginTop: 8, fontSize: 12, fontWeight: 'bold' }}>Add Photo</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}

            {fileUris.length === 0 && (
              <View style={styles.mediaActions}>
                <TouchableOpacity onPress={() => handleTakePhoto(false)} style={styles.mediaButton}>
                  <Ionicons name="camera" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleGalleryPick(false)} style={styles.mediaButton}>
                  <Ionicons name="image" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleUploadFile(false)} style={styles.mediaButton}>
                  <Ionicons name="document-text" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>PDF</Text>
                </TouchableOpacity>
              </View>
            )}

            {(() => {
              const isAddSaveEnabled = docTitle.trim().length > 0 && (docContent.trim().length > 0 || fileUris.length > 0) && !isEncrypting;
              return (
                <View style={styles.modalActions}>
                  <TouchableOpacity onPress={() => { setModalVisible(false); setFileUris([]); setFileType(null); setDocTitle(''); setDocContent(''); setDocNumber(''); setDocStartDate(''); setDocEndDate(''); setDocDatesEdited(false); setDocHasExpiry(false); setDateScanStatus('idle'); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]} disabled={isEncrypting}>
                    <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={handleAddDocument} 
                    style={[styles.button, { opacity: isAddSaveEnabled ? 1 : 0.4 }]} 
                    disabled={!isAddSaveEnabled}
                    {...(Platform.OS === 'web' ? { title: isAddSaveEnabled ? 'Save this document' : 'Please enter a title and add notes or attach a file' } : {})}
                  >
                    {isEncrypting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })()}
            </ScrollView>
          </View>

        </KeyboardAvoidingView>

        {/* Rendered inside this modal so touches work on iOS */}
        <DatePickerModal
          inline
          visible={datePickerTarget === 'add-start' || datePickerTarget === 'add-end'}
          title={datePickerTarget === 'add-start' ? 'Select Start Date' : 'Select End Date'}
          value={datePickerTarget === 'add-start' ? docStartDate : docEndDate}
          onSelect={(picked) => {
            setDocDatesEdited(true);
            if (datePickerTarget === 'add-start') setDocStartDate(picked);
            else setDocEndDate(picked);
          }}
          onClose={() => setDatePickerTarget(null)}
        />

        {renderDateVerifyOverlay('add')}

        {Platform.OS === 'ios' && cropTarget === 'add' && cropIndex !== null && cropIndex >= 0 && !!fileUris[cropIndex] && (
          <View style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', zIndex: 999999, elevation: 999999, backgroundColor: '#000' }]}>
            <CustomImageCropper
              imageUri={fileUris[cropIndex]}
              onCropDone={(croppedBase64Uri) => {
                const updated = [...fileUris];
                updated[cropIndex] = croppedBase64Uri;
                setFileUris(updated);
                setCropIndex(null);
                setCropTarget(null);
              }}
              onCancel={() => {
                setCropIndex(null);
                setCropTarget(null);
              }}
            />
          </View>
        )}
      </Modal>

      {/* EDIT DOCUMENT MODAL */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]}>Edit Document</Text>
              <ModalCloseButton onPress={closeEditDocument} />
            </View>

            <TextInput
              style={[styles.input, { letterSpacing: 0 }]}
              placeholder="Title"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={editDocTitle}
              onChangeText={(text) => {
                setEditDocTitle(text);
                if (!editDocDatesEdited) {
                  const detected = extractDatesFromText(`${text}\n${editDocContent}`);
                  // Only ever fill in what was found. Overwriting unconditionally
                  // would wipe dates the OCR scan already recovered from the file.
                  if (detected.startDate || detected.endDate) {
                    setEditDocStartDate(detected.startDate);
                    setEditDocEndDate(detected.endDate);
                    setEditDocHasExpiry(true);
                  }
                  const foundNumber = extractDocumentNumber(`${text}\n${editDocContent}`);
                  if (foundNumber && !editDocNumber.trim()) setEditDocNumber(foundNumber);
                }
              }}
            />

            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top', letterSpacing: 0 }]}
              placeholder="Description / Notes"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={editDocContent}
              onChangeText={(text) => {
                setEditDocContent(text);
                if (!editDocDatesEdited) {
                  const detected = extractDatesFromText(`${editDocTitle}\n${text}`);
                  // Only ever fill in what was found. Overwriting unconditionally
                  // would wipe dates the OCR scan already recovered from the file.
                  if (detected.startDate || detected.endDate) {
                    setEditDocStartDate(detected.startDate);
                    setEditDocEndDate(detected.endDate);
                    setEditDocHasExpiry(true);
                  }
                  const foundNumber = extractDocumentNumber(`${editDocTitle}\n${text}`);
                  if (foundNumber && !editDocNumber.trim()) setEditDocNumber(foundNumber);
                }
              }}
              multiline
            />


            {/* DOCUMENT NUMBER — passport no, card no, policy no and so on */}
            <Text style={styles.fieldLabel}>Number</Text>
            <View style={styles.numberRow}>
              <TextInput
                style={[styles.input, styles.numberInput]}
                placeholder="Passport / card / policy number"
                placeholderTextColor={AppTheme.colors.textSecondary}
                value={editDocNumber}
                onChangeText={(text) => { setEditDocNumber(text); setEditDocDatesEdited(true); }}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                onPress={() => handleCopyNumber(editDocNumber)}
                style={[styles.copyButton, !editDocNumber.trim() && styles.copyButtonDisabled]}
                disabled={!editDocNumber.trim()}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={18} color={editDocNumber.trim() ? AppTheme.colors.primary : '#cbd5e1'} />
              </TouchableOpacity>
            </View>
            {!!editDocNumber.trim() && copiedNumber === editDocNumber.trim() && (
              <Text style={styles.copiedBadge}>Copied to clipboard</Text>
            )}
            <TouchableOpacity
              onPress={() => setEditDocHasExpiry(!editDocHasExpiry)}
              style={styles.checkboxRow}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, editDocHasExpiry && styles.checkboxChecked]}>
                {editDocHasExpiry && <Ionicons name="checkmark" size={14} color="#ffffff" />}
              </View>
              <Text style={styles.checkboxLabel}>Has expiry?</Text>
              {isScanningDates && (
                <View style={styles.scanningBadge}>
                  <ActivityIndicator size="small" color={AppTheme.colors.primary} />
                  <Text style={styles.scanningText}>Reading dates…</Text>
                </View>
              )}
            </TouchableOpacity>

            {editDocHasExpiry && (
              <>
                <View style={styles.dateRow}>
                  <View style={styles.dateField}>
                    <Text style={styles.dateLabel}>Start Date</Text>
                    <View style={styles.dateInputWrap}>
                      <TextInput
                        style={[styles.input, styles.dateInput]}
                        placeholder="DD-MM-YYYY"
                        placeholderTextColor={AppTheme.colors.textSecondary}
                        value={editDocStartDate}
                        onChangeText={(text) => { setEditDocDatesEdited(true); setEditDocStartDate(text); }}
                      />
                      <TouchableOpacity
                        onPress={() => setDatePickerTarget('edit-start')}
                        style={styles.calendarBtn}
                        {...(Platform.OS === 'web' ? { title: 'Pick start date' } : {})}
                      >
                        <Ionicons name="calendar-outline" size={18} color={AppTheme.colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.dateField}>
                    <Text style={styles.dateLabel}>End Date</Text>
                    <View style={styles.dateInputWrap}>
                      <TextInput
                        style={[styles.input, styles.dateInput]}
                        placeholder="DD-MM-YYYY"
                        placeholderTextColor={AppTheme.colors.textSecondary}
                        value={editDocEndDate}
                        onChangeText={(text) => { setEditDocDatesEdited(true); setEditDocEndDate(text); }}
                      />
                      <TouchableOpacity
                        onPress={() => setDatePickerTarget('edit-end')}
                        style={styles.calendarBtn}
                        {...(Platform.OS === 'web' ? { title: 'Pick end date' } : {})}
                      >
                        <Ionicons name="calendar-outline" size={18} color={AppTheme.colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                {!editDocDatesEdited && (editDocStartDate || editDocEndDate) ? (
                  <Text style={styles.dateHint}>
                    Dates were read from the document — check the file and confirm them. You can edit them later too.
                  </Text>
                ) : null}
              </>
            )}

            {editFileUris.length > 0 && (
              <View style={styles.filePreviewContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10 }}>
                  {editFileUris.map((uri, idx) => {
                    const safeUri = getSafeImageUri(uri);
                    return (
                      <View key={idx} style={styles.thumbnailWrapper}>
                        {editFileType === 'image' && safeUri ? (
                          <Image source={{ uri: safeUri }} style={styles.thumbnailImage} />
                        ) : editFileType === 'image' && !safeUri ? (
                          <View style={styles.thumbnailPdf}>
                            <Ionicons name="warning" size={48} color={AppTheme.colors.error} />
                            <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>Invalid Image</Text>
                          </View>
                        ) : (
                          <View style={styles.thumbnailPdf}>
                            <Ionicons name="document" size={48} color={AppTheme.colors.primary} />
                            <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>PDF {idx + 1}</Text>
                          </View>
                        )}
                        {editFileType === 'image' && (
                          <TouchableOpacity
                            style={{
                              position: 'absolute',
                              bottom: -6,
                              left: -6,
                              backgroundColor: AppTheme.colors.primary,
                              borderRadius: 12,
                              padding: 4,
                              elevation: 3,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.2,
                              shadowRadius: 3,
                            }}
                            onPress={() => {
                              setCropTarget('edit');
                              setCropIndex(idx);
                            }}
                            {...(Platform.OS === 'web' ? { title: 'Crop / Adjust Borders' } : {})}
                          >
                            <Ionicons name="crop" size={16} color="#fff" />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.removeFileBtn}
                          onPress={() => {
                            const newUris = [...editFileUris];
                            newUris.splice(idx, 1);
                            setEditFileUris(newUris);
                            if (newUris.length === 0) setEditFileType(null);
                          }}
                          {...(Platform.OS === 'web' ? { title: 'Remove Attachment' } : {})}
                        >
                          <Ionicons name="close" size={16} color={AppTheme.colors.error} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                  {/* Option to add more photos while editing */}
                  {editFileType === 'image' && (
                    <TouchableOpacity onPress={() => handleTakePhoto(true)} style={styles.addMoreTile}>
                      <Ionicons name="camera" size={32} color={AppTheme.colors.primary} />
                      <Text style={{ color: AppTheme.colors.primary, marginTop: 8, fontSize: 12, fontWeight: 'bold' }}>Add Photo</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}

            {/* Media buttons inside edit modal */}
            {editFileUris.length === 0 && (
              <View style={styles.mediaActions}>
                <TouchableOpacity onPress={() => handleTakePhoto(true)} style={styles.mediaButton}>
                  <Ionicons name="camera" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleGalleryPick(true)} style={styles.mediaButton}>
                  <Ionicons name="image" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleUploadFile(true)} style={styles.mediaButton}>
                  <Ionicons name="document-text" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>PDF</Text>
                </TouchableOpacity>
              </View>
            )}

            {(() => {
              const isEditSaveEnabled = editDocTitle.trim().length > 0 && (editDocContent.trim().length > 0 || editFileUris.length > 0) && !isUpdating;
              return (
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setEditModalVisible(false);
                      setEditingDoc(null);
                      setEditDocTitle('');
                      setEditDocContent('');
                      setEditDocStartDate('');
                      setEditDocEndDate('');
                      setEditDocDatesEdited(false);
                      setEditDocHasExpiry(false);
                      setEditFileUris([]);
                      setEditFileType(null);
                    }}
                    style={[styles.button, { backgroundColor: AppTheme.colors.border }]}
                    disabled={isUpdating}
                  >
                    <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={handleSaveEditDoc} 
                    style={[styles.button, { opacity: isEditSaveEnabled ? 1 : 0.4 }]} 
                    disabled={!isEditSaveEnabled}
                    {...(Platform.OS === 'web' ? { title: isEditSaveEnabled ? 'Save Changes' : 'Please enter a title and add notes or attach a file' } : {})}
                  >
                    {isUpdating ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>Save Changes</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })()}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>

        {/* Rendered inside this modal so touches work on iOS */}
        <DatePickerModal
          inline
          visible={datePickerTarget === 'edit-start' || datePickerTarget === 'edit-end'}
          title={datePickerTarget === 'edit-start' ? 'Select Start Date' : 'Select End Date'}
          value={datePickerTarget === 'edit-start' ? editDocStartDate : editDocEndDate}
          onSelect={(picked) => {
            setEditDocDatesEdited(true);
            if (datePickerTarget === 'edit-start') setEditDocStartDate(picked);
            else setEditDocEndDate(picked);
          }}
          onClose={() => setDatePickerTarget(null)}
        />

        {renderDateVerifyOverlay('edit')}

        {Platform.OS === 'ios' && cropTarget === 'edit' && cropIndex !== null && cropIndex >= 0 && !!editFileUris[cropIndex] && (
          <View style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', zIndex: 999999, elevation: 999999, backgroundColor: '#000' }]}>
            <CustomImageCropper
              imageUri={editFileUris[cropIndex]}
              onCropDone={(croppedBase64Uri) => {
                const updated = [...editFileUris];
                updated[cropIndex] = croppedBase64Uri;
                setEditFileUris(updated);
                setCropIndex(null);
                setCropTarget(null);
              }}
              onCancel={() => {
                setCropIndex(null);
                setCropTarget(null);
              }}
            />
          </View>
        )}
      </Modal>

      {/* VIEW DOCUMENT MODAL (Popup) */}
      <Modal 
        visible={viewModalVisible} 
        animationType="slide" 
        transparent={false}
        onRequestClose={() => setViewModalVisible(false)}
      >
        <View style={styles.fullScreenModal}>

          <View style={[styles.fullScreenHeader, { paddingTop: isMobile ? Math.max(insets.top + 8, 16) : 16 }]}>
            <TouchableOpacity onPress={() => setViewModalVisible(false)} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={AppTheme.colors.text} />
            </TouchableOpacity>
            <Text style={styles.fullScreenTitle} numberOfLines={1} ellipsizeMode="tail">
              {selectedDoc?.title}
            </Text>
          </View>

          <View style={styles.fullScreenContent}>
            {(() => {
              const { notes, files } = parseDecryptedPayload(decryptedText);
              const displayFiles = decryptedArray.length > 0 ? decryptedArray : files;
              const isPdf = selectedDoc?.type === 'pdf' || (displayFiles[0] && (displayFiles[0].includes('application/pdf') || displayFiles[0].endsWith('.pdf')));

              // Dedicated full-screen PDF view when single PDF and no notes for direct gesture handling
              if (displayFiles.length === 1 && isPdf && !notes) {
                const uri = displayFiles[0];
                return (
                  <View style={{ flex: 1, position: 'relative' }}>
                    {Platform.OS === 'web' ? (
                      React.createElement('div', {
                        style: { width: '100%', height: '100%' },
                      }, React.createElement('iframe', {
                        src: getPdfBlobUrl(uri),
                        style: { width: '100%', height: '100%', border: 'none', borderRadius: 12 },
                        title: selectedDoc?.title,
                      }))
                    ) : (
                      <PdfViewer 
                        uri={uri} 
                        style={{ flex: 1, borderRadius: 12 }} 
                        singlePageOnly={false}
                      />
                    )}
                    <TouchableOpacity
                      onPress={() => handleDownloadFile(uri, selectedDoc.title, 'pdf', 0)}
                      style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', zIndex: 10 }}
                    >
                      <Ionicons name="download-outline" size={20} color="#fff" />
                      <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Save / Open PDF</Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              return (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
                  {displayFiles.length === 0 && !!notes && (
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.85)', padding: 18, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: AppTheme.colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}>
                      <Text style={{ fontSize: 16, color: AppTheme.colors.text, lineHeight: 24 }}>{notes}</Text>
                    </View>
                  )}

                  {displayFiles.length > 0 && !isPdf && (
                    displayFiles.map((uri, idx) => {
                      const safeUri = getSafeImageUri(uri);
                      if (!safeUri) return null;
                      return (
                        <View key={idx} style={{ marginBottom: 20, position: 'relative' }}>
                          <ZoomableImage uri={safeUri} height={isMobile ? 480 : 600} />
                          <TouchableOpacity
                            onPress={() => handleDownloadFile(uri, selectedDoc.title, 'image', idx)}
                            style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', zIndex: 10 }}
                          >
                            <Ionicons name="download-outline" size={20} color="#fff" />
                            <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Save Image</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}

                  {displayFiles.length > 0 && isPdf && (
                    Platform.OS === 'web' ? (
                      displayFiles.map((uri, idx) => {
                        const blobUrl = getPdfBlobUrl(uri);
                        return (
                          React.createElement('div', {
                            key: idx,
                            style: { width: '100%', height: 750, marginBottom: 20 },
                          }, React.createElement('iframe', {
                            src: blobUrl,
                            style: { width: '100%', height: '100%', border: 'none', borderRadius: 12 },
                            title: `${selectedDoc?.title} ${idx + 1}`,
                          }))
                        );
                      })
                    ) : (
                      displayFiles.map((uri, idx) => (
                        <View key={idx} style={{ height: 650, marginBottom: 20 }}>
                          <PdfViewer 
                            uri={uri} 
                            style={{ flex: 1, borderRadius: 12 }} 
                            singlePageOnly={false}
                          />
                          <TouchableOpacity
                            onPress={() => handleDownloadFile(uri, selectedDoc.title, 'pdf', idx)}
                            style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', zIndex: 10 }}
                          >
                            <Ionicons name="download-outline" size={20} color="#fff" />
                            <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Save / Open PDF</Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )
                  )}

                  {displayFiles.length === 0 && !notes && isOpeningDoc && (
                    <View style={{ alignItems: 'center', marginTop: 40 }}>
                      <ActivityIndicator size="large" color={AppTheme.colors.primary} />
                      <Text style={{ color: AppTheme.colors.textSecondary, marginTop: 12 }}>Decrypting…</Text>
                    </View>
                  )}

                  {displayFiles.length === 0 && !notes && !isOpeningDoc && (
                    <Text style={{ color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>No description or file content found.</Text>
                  )}
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* WEB CAMERA MODAL */}
      <Modal visible={webCameraVisible} animationType="slide" transparent={false}>
        <WebCamera onCapture={handleWebCameraCapture} onClose={() => setWebCameraVisible(false)} />
      </Modal>

      {/* CROPPER FULLSCREEN MODAL (Non-iOS / Fallback) */}
      {Platform.OS !== 'ios' && (
        <Modal
          visible={cropIndex !== null && cropIndex >= 0}
          animationType="fade"
          transparent={false}
          onRequestClose={() => {
            setCropIndex(null);
            setCropTarget(null);
          }}
        >
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {cropIndex !== null && cropIndex >= 0 && (
              <CustomImageCropper
                imageUri={cropTarget === 'edit' ? editFileUris[cropIndex] : fileUris[cropIndex]}
                onCropDone={(croppedBase64Uri) => {
                  if (cropTarget === 'edit') {
                    const updated = [...editFileUris];
                    updated[cropIndex] = croppedBase64Uri;
                    setEditFileUris(updated);
                  } else {
                    const updated = [...fileUris];
                    updated[cropIndex] = croppedBase64Uri;
                    setFileUris(updated);
                  }
                  setCropIndex(null);
                  setCropTarget(null);
                }}
                onCancel={() => {
                  setCropIndex(null);
                  setCropTarget(null);
                }}
              />
            )}
          </View>
        </Modal>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      <Modal visible={!!deleteConfirmDoc} animationType="fade" transparent>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}>
          <View style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 24,
            maxWidth: 380,
            width: '100%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 8,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: '#fee2e2',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 12,
              }}>
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: AppTheme.colors.text, flex: 1 }}>Delete Document</Text>
              <ModalCloseButton onPress={() => setDeleteConfirmDoc(null)} />
            </View>
            <Text style={{ fontSize: 14, color: AppTheme.colors.textSecondary, lineHeight: 20, marginBottom: 20 }}>
              Are you sure you want to delete "{deleteConfirmDoc?.title}"? This action cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity
                onPress={() => setDeleteConfirmDoc(null)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 20,
                  borderRadius: 8,
                  backgroundColor: '#f1f5f9',
                  marginRight: 10,
                }}
              >
                <Text style={{ color: AppTheme.colors.text, fontWeight: '600', fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDelete}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 20,
                  borderRadius: 8,
                  backgroundColor: '#ef4444',
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>




      {/* Document Sort / Filter Modal */}
      <Modal
        visible={sortModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.sortModalOverlay} 
          activeOpacity={1} 
          onPress={() => setSortModalVisible(false)}
        >
          <View 
            style={styles.sortModalContent}
            onStartShouldSetResponder={() => true}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: AppTheme.colors.primaryLight,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginRight: 10,
                }}>
                  <Ionicons name="filter" size={18} color={AppTheme.colors.primary} />
                </View>
                <View>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: AppTheme.colors.text }}>Sort Files</Text>
                  <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary }}>Choose display order</Text>
                </View>
              </View>
              <TouchableOpacity 
                onPress={() => setSortModalVisible(false)}
                style={{ padding: 6 }}
                {...(Platform.OS === 'web' ? { title: 'Close' } : {})}
              >
                <Ionicons name="close" size={20} color={AppTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {DOC_SORT_OPTIONS.map((opt) => {
              const isSelected = sortOption === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.sortOptionItem,
                    isSelected && styles.sortOptionItemSelected,
                  ]}
                  onPress={() => {
                    setSortOption(opt.id);
                    setSortModalVisible(false);
                    StorageService.setItem('@offline_locker_doc_sort_option', opt.id);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <View style={[
                      styles.sortOptionIconBox,
                      isSelected && { backgroundColor: AppTheme.colors.primary }
                    ]}>
                      <Ionicons 
                        name={opt.icon} 
                        size={18} 
                        color={isSelected ? '#ffffff' : AppTheme.colors.primary} 
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.sortOptionTitle,
                        isSelected && { color: AppTheme.colors.primary, fontWeight: '700' }
                      ]}>
                        {opt.label}
                      </Text>
                      <Text style={styles.sortOptionDesc}>{opt.desc}</Text>
                    </View>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={AppTheme.colors.primary} style={{ marginLeft: 8 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

/**
 * Built per accent rather than once at import: StyleSheet.create captures the
 * colours it is given, so a theme change has to rebuild these to take effect.
 */
const createStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: AppTheme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: AppTheme.colors.background },
  docCard: { 
    backgroundColor: '#ffffff', 
    padding: AppTheme.spacing.m, 
    borderRadius: AppTheme.borderRadius.l, 
    marginBottom: AppTheme.spacing.m, 
    borderWidth: 1, 
    borderColor: '#f1f5f9', 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.03, 
    shadowRadius: 12, 
    elevation: 2 
  },
  docTitle: { color: AppTheme.colors.text, fontSize: 17, fontWeight: '700' },
  docDate: { color: AppTheme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  docThumbBox: { width: 56, height: 56, borderRadius: 14, backgroundColor: AppTheme.colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 14, overflow: 'hidden' },
  typeBadge: { alignSelf: 'flex-start', backgroundColor: AppTheme.colors.primaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, marginTop: 6 },
  typeBadgeText: { color: AppTheme.colors.primary, fontSize: 11, fontWeight: '700' },
  cardActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  cardActionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  cardActionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: AppTheme.colors.primaryLight, borderRadius: 8 },
  cardActionText: { color: AppTheme.colors.primary, fontSize: 13, fontWeight: '600' },
  actionDivider: { width: 1, height: 16, backgroundColor: '#e2e8f0' },
  emptyText: { color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40, fontSize: 15 },
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: AppTheme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 6, zIndex: 10, shadowColor: AppTheme.colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', justifyContent: 'center', padding: AppTheme.spacing.l },
  modalContent: { maxHeight: '90%', backgroundColor: '#ffffff', padding: AppTheme.spacing.l, borderRadius: AppTheme.borderRadius.xl, maxWidth: 600, width: '100%', alignSelf: 'center', borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 6 },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: AppTheme.spacing.m },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', color: AppTheme.colors.text, padding: 14, borderRadius: AppTheme.borderRadius.s, marginBottom: AppTheme.spacing.m, fontSize: 15, letterSpacing: 0 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: AppTheme.colors.textSecondary, marginBottom: 6 },
  numberRow: { flexDirection: 'row', alignItems: 'flex-start' },
  // The input keeps the shared `input` style; only the row layout differs
  numberInput: { flex: 1, marginRight: 8 },
  copyButton: {
    width: 46,
    height: 46,
    borderRadius: AppTheme.borderRadius.s,
    borderWidth: 1,
    borderColor: AppTheme.colors.primaryBorder,
    backgroundColor: AppTheme.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyButtonDisabled: { borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
  copiedBadge: { fontSize: 11, fontWeight: '700', color: '#15803d', marginTop: -8, marginBottom: 10 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: AppTheme.spacing.m },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: AppTheme.colors.border,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: { backgroundColor: AppTheme.colors.primary, borderColor: AppTheme.colors.primary },
  checkboxLabel: { fontSize: 15, fontWeight: '600', color: AppTheme.colors.text },
  scanningBadge: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  scanningText: { marginLeft: 6, fontSize: 12, color: AppTheme.colors.primary, fontWeight: '600' },
  dateRow: { flexDirection: 'row', marginBottom: AppTheme.spacing.m },
  dateField: { flex: 1, marginHorizontal: 3 },
  dateInputWrap: { position: 'relative', justifyContent: 'center' },
  dateInput: { marginBottom: 0, paddingLeft: 10, paddingRight: 34, fontSize: 14, letterSpacing: 0 },
  calendarBtn: { position: 'absolute', right: 4, padding: 5 },
  dateLabel: { color: AppTheme.colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 5 },
  dateHint: { color: '#b45309', fontSize: 12, marginTop: -8, marginBottom: AppTheme.spacing.m, lineHeight: 16 },
  mediaActions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: AppTheme.spacing.m },
  mediaButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: AppTheme.colors.primaryLight, borderWidth: 1, borderColor: AppTheme.colors.primaryBorder, padding: 12, borderRadius: AppTheme.borderRadius.s, marginHorizontal: 2 },
  mediaButtonText: { color: AppTheme.colors.primary, marginLeft: 6, fontWeight: '600', fontSize: 13 },

  // Multi-file thumbnails
  filePreviewContainer: { marginBottom: AppTheme.spacing.m },
  thumbnailWrapper: { position: 'relative', marginRight: 16, width: 120, height: 120, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8 },
  thumbnailImage: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m },
  thumbnailPdf: { width: 120, height: 120, backgroundColor: '#f8fafc', borderRadius: AppTheme.borderRadius.m, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  removeFileBtn: { position: 'absolute', top: -8, right: -8, width: 26, height: 26, borderRadius: 13, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#fee2e2', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, zIndex: 10, elevation: 4 },
  addMoreTile: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m, borderWidth: 1.5, borderColor: AppTheme.colors.primary, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: AppTheme.colors.primaryLight },

  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: AppTheme.spacing.s },
  button: { flex: 1, backgroundColor: AppTheme.colors.primary, paddingVertical: 14, borderRadius: AppTheme.borderRadius.s, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  decryptedBox: { backgroundColor: '#f8fafc', padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.s, marginVertical: AppTheme.spacing.m, minHeight: 100, borderWidth: 1, borderColor: '#e2e8f0' },
  decryptedText: { color: AppTheme.colors.text, fontSize: 16, lineHeight: 24 },

  fullScreenModal: { flex: 1, backgroundColor: AppTheme.colors.background },
  fullScreenHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  fullScreenTitle: { flex: 1, marginHorizontal: 8, color: AppTheme.colors.text, fontSize: 15, fontWeight: '800' },
  // Matches the plain close in the Notes writer rather than a red badge
  closeButton: { padding: 6 },
  fullScreenContent: { flex: 1, padding: 16 },
  fullScreenText: { color: AppTheme.colors.text, fontSize: 18, lineHeight: 28 },

  // Sort Modal Styles
  sortModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: AppTheme.spacing.l,
  },
  sortModalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    maxWidth: 400,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  sortOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  sortOptionItemSelected: {
    backgroundColor: AppTheme.colors.primaryLight,
    borderColor: AppTheme.colors.primaryBorder,
  },
  sortOptionIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: AppTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sortOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: AppTheme.colors.text,
  },
  sortOptionDesc: {
    fontSize: 12,
    color: AppTheme.colors.textSecondary,
    marginTop: 2,
  }
});
