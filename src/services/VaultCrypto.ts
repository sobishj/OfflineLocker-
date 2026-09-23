import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import CryptoJS from 'crypto-js';
import { CryptoService } from './CryptoService';

/**
 * The vault's encryption, version 3.
 *
 * Every vault has one random 256-bit key. Content is sealed with it using
 * AES-256-GCM in native code - a fresh nonce per value and an authentication
 * tag, so tampering is caught rather than decrypted into garbage.
 *
 * The key is never written to the database. On iOS and Android it lives in the
 * Keychain / Keystore, so a copy of the database file on its own decrypts
 * nothing. The web has no such store and keeps it in browser storage.
 *
 * PINs are no longer keys; they are checked against an HMAC keyed from the
 * vault key, so a PIN can only be guessed on the device, where the lockout and
 * wipe apply, and changing one never re-encrypts anything.
 *
 * Data written before this version (AES-CBC under the stored PIN hash, see
 * CryptoService) still decrypts, through the legacy keys handed to `open`,
 * until the background migration has rewritten it.
 */

export const ENC3_PREFIX = 'ENC3:';

/**
 * Sealed values are stored as base64 of nonce | ciphertext | tag. The 12-byte
 * nonce is exactly 16 base64 characters, so the text splits into two base64
 * parts without decoding it in JavaScript.
 *
 * `AESSealedData.fromCombined` is not used for reading: on Android it only
 * accepts bytes and throws on the base64 text the other platforms take.
 * `fromParts` takes base64 everywhere, and the decoding stays native.
 */
const NONCE_B64_LENGTH = 16;
const TAG_LENGTH = 16;

export const sealedFromBase64 = (combinedB64: string): Crypto.AESSealedData =>
  Crypto.AESSealedData.fromParts(combinedB64.slice(0, NONCE_B64_LENGTH), combinedB64.slice(NONCE_B64_LENGTH), TAG_LENGTH);
export const DECRYPTION_FAILED = '⚠️ Decryption Failed: Invalid Key or Corrupted Data';

export type PinScope = 'app' | 'tab' | 'note' | 'diary';

const VERIFIER_PREFIX = 'h1$';
const VERIFIER_LABEL = 'offlinelocker/pin-verifier/v1';

interface OpenVault {
  userId: string;
  key: Crypto.AESEncryptionKey;
  /** HMAC key for PIN verifiers, derived from the vault key. */
  verifierKey: CryptoJS.lib.WordArray;
  /** Keys that older ciphertext may be under, tried after the vault key. */
  legacyKeys: string[];
}

let current: OpenVault | null = null;

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

// ---------------------------------------------------------------------------
// Key storage
// ---------------------------------------------------------------------------

/** SecureStore keys may hold only letters, digits, '.', '-' and '_'. */
const keyName = (userId: string) => `olvault.${userId}.key`.replace(/[^A-Za-z0-9._-]/g, '_');

// Not "this device only": an encrypted iCloud / Finder backup then carries the
// key along with the app's data, so moving to a new iPhone keeps the vault
// readable. A plain copy of the database never includes it.
const STORE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED };

const readStoredKey = async (userId: string): Promise<string | null> => {
  try {
    if (isNative) return await SecureStore.getItemAsync(keyName(userId), STORE_OPTIONS);
    return typeof localStorage !== 'undefined' ? localStorage.getItem(keyName(userId)) : null;
  } catch {
    return null;
  }
};

const writeStoredKey = async (userId: string, keyB64: string): Promise<void> => {
  if (isNative) {
    await SecureStore.setItemAsync(keyName(userId), keyB64, STORE_OPTIONS);
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(keyName(userId), keyB64);
  }
};

const deleteStoredKey = async (userId: string): Promise<void> => {
  try {
    if (isNative) await SecureStore.deleteItemAsync(keyName(userId), STORE_OPTIONS);
    else if (typeof localStorage !== 'undefined') localStorage.removeItem(keyName(userId));
  } catch {
    // Already gone
  }
};

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

/** UTF-8 bytes of a string. The fallback only runs where TextEncoder is missing. */
export const utf8Encode = (text: string): Uint8Array => {
  if (encoder) return encoder.encode(text);
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) {
      out[n++] = c;
    } else if (c < 0x800) {
      out[n++] = 0xc0 | (c >> 6);
      out[n++] = 0x80 | (c & 63);
    } else {
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next < 0xe000) {
          c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
          i++;
          out[n++] = 0xf0 | (c >> 18);
          out[n++] = 0x80 | ((c >> 12) & 63);
          out[n++] = 0x80 | ((c >> 6) & 63);
          out[n++] = 0x80 | (c & 63);
          continue;
        }
      }
      out[n++] = 0xe0 | (c >> 12);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    }
  }
  return out.subarray(0, n);
};

const CHUNK = 0x2000;

/**
 * String from UTF-8 bytes. Payloads are mostly base64 file data, so the
 * fallback turns runs of ASCII into strings a chunk at a time rather than a
 * character at a time.
 */
export const utf8Decode = (bytes: Uint8Array): string => {
  if (decoder) return decoder.decode(bytes);
  const parts: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const end = Math.min(i + CHUNK, bytes.length);
    let ascii = true;
    for (let j = i; j < end; j++) {
      if (bytes[j] >= 0x80) { ascii = false; break; }
    }
    if (ascii) {
      parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end))));
      i = end;
      continue;
    }
    // A multi-byte character may straddle the chunk edge, so decode to the
    // chunk's end and then finish whatever character is left open
    const codes: number[] = [];
    while (i < end || (i < bytes.length && (bytes[i] & 0xc0) === 0x80)) {
      const b = bytes[i++];
      if (b < 0x80) codes.push(b);
      else if (b < 0xe0) codes.push(((b & 31) << 6) | (bytes[i++] & 63));
      else if (b < 0xf0) codes.push(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      else {
        const cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        const v = cp - 0x10000;
        codes.push(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
      }
    }
    parts.push(String.fromCharCode.apply(null, codes));
  }
  return parts.join('');
};

const bytesToWordArray = (bytes: Uint8Array): CryptoJS.lib.WordArray => {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  return CryptoJS.lib.WordArray.create(words, bytes.length);
};

const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** Equal-time comparison, so a wrong guess takes as long as a nearly-right one. */
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const requireOpen = (): OpenVault => {
  if (!current) throw new Error('VAULT_LOCKED');
  return current;
};

const openWithKey = async (userId: string, key: Crypto.AESEncryptionKey, legacyKeys: string[]) => {
  const raw = await key.bytes();
  current = {
    userId,
    key,
    verifierKey: CryptoJS.HmacSHA256(VERIFIER_LABEL, bytesToWordArray(raw)),
    legacyKeys: legacyKeys.filter(Boolean),
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const VaultCrypto = {
  isOpen: () => current !== null,
  openUserId: () => current?.userId ?? null,

  async hasStoredKey(userId: string): Promise<boolean> {
    return !!(await readStoredKey(userId));
  },

  /** A new vault: generates and stores its key, then opens it. */
  async create(userId: string, legacyKeys: string[] = []): Promise<void> {
    const key = await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256);
    await writeStoredKey(userId, await key.encoded('base64'));
    await openWithKey(userId, key, legacyKeys);
  },

  /** Opens an existing vault. False when this device has no key for it. */
  async open(userId: string, legacyKeys: string[] = []): Promise<boolean> {
    const stored = await readStoredKey(userId);
    if (!stored) return false;
    const key = await Crypto.AESEncryptionKey.import(stored, 'base64');
    await openWithKey(userId, key, legacyKeys);
    return true;
  },

  /** Installs a key that arrived in a backup, replacing any stored for that user. */
  async adoptKey(userId: string, keyB64: string, legacyKeys: string[] = []): Promise<void> {
    const key = await Crypto.AESEncryptionKey.import(keyB64, 'base64');
    await writeStoredKey(userId, keyB64);
    await openWithKey(userId, key, legacyKeys);
  },

  /** The open vault's key, for a backup. It leaves only inside an encrypted file. */
  async exportKey(): Promise<string> {
    return requireOpen().key.encoded('base64');
  },

  setLegacyKeys(keys: string[]) {
    if (current) current.legacyKeys = keys.filter(Boolean);
  },

  legacyKeys(): string[] {
    return current ? [...current.legacyKeys] : [];
  },

  close() {
    current = null;
  },

  /** Removes a vault's key from this device, as part of wiping or replacing it. */
  async destroy(userId: string | undefined): Promise<void> {
    if (!userId) return;
    if (current?.userId === userId) current = null;
    await deleteStoredKey(userId);
  },

  isCurrentFormat(value: string | null | undefined): boolean {
    return !!value && value.startsWith(ENC3_PREFIX);
  },

  async encrypt(plain: string): Promise<string> {
    if (!plain) return '';
    const vault = requireOpen();
    const sealed = await Crypto.aesEncryptAsync(utf8Encode(plain), vault.key);
    return ENC3_PREFIX + (await sealed.combined('base64'));
  },

  /**
   * Plaintext for any stored value: version 3, the older CBC formats (under the
   * legacy keys plus `extraKeys`), or text that was never encrypted. Failure
   * returns DECRYPTION_FAILED, as the older code did.
   */
  async decrypt(value: string | null | undefined, extraKeys: (string | null | undefined)[] = []): Promise<string> {
    if (!value) return '';
    const vault = requireOpen();
    if (value.startsWith(ENC3_PREFIX)) {
      try {
        const sealed = sealedFromBase64(value.slice(ENC3_PREFIX.length));
        const bytes = await Crypto.aesDecryptAsync(sealed, vault.key);
        return utf8Decode(bytes);
      } catch {
        return DECRYPTION_FAILED;
      }
    }
    const keys = [...vault.legacyKeys, ...extraKeys.filter((k): k is string => !!k), 'default_fallback'];
    return CryptoService.decryptWithKeys(value, keys);
  },

  /** Names and titles: version 3 is decrypted, anything else was stored plain. */
  async decryptLabel(value: string | null | undefined): Promise<string> {
    if (!value) return '';
    if (!value.startsWith(ENC3_PREFIX)) return value;
    const plain = await this.decrypt(value);
    return plain === DECRYPTION_FAILED ? '' : plain;
  },

  // --- PIN verifiers ------------------------------------------------------

  makeVerifier(pin: string, scope: PinScope): string {
    const vault = requireOpen();
    const clean = pin.trim();
    const salt = toHex(Crypto.getRandomBytes(16));
    const mac = CryptoJS.HmacSHA256(`${scope}|${salt}|${clean}`, vault.verifierKey).toString(CryptoJS.enc.Hex);
    return `${VERIFIER_PREFIX}${clean.length}$${salt}$${mac}`;
  },

  isVerifier(stored: string | null | undefined): boolean {
    return !!stored && stored.startsWith(VERIFIER_PREFIX);
  },

  /**
   * The key the old format encrypted with, for a given account PIN. It was only
   * ever a hash of the PIN, so typing the PIN is enough to recover it.
   */
  legacyKeyForPin(pin: string): string {
    return CryptoService.hashPin(pin.trim());
  },

  /** A stored hash from before version 3: SHA-256 of the PIN and a fixed salt. */
  isLegacyHash(stored: string | null | undefined): boolean {
    return !!stored && /^[0-9a-f]{64}$/.test(stored);
  },

  /** How many digits the PIN behind a stored hash has, so the keypad can wait for them. */
  pinLength(stored: string | null | undefined): number {
    if (stored && stored.startsWith(VERIFIER_PREFIX)) {
      const n = parseInt(stored.split('$')[1], 10);
      if (n > 0) return n;
    }
    return 4;
  },

  /** True when `pin` matches. Works for both verifier and legacy hashes. */
  checkPin(pin: string, stored: string | null | undefined, scope: PinScope): boolean {
    if (!stored) return false;
    const clean = pin.trim();
    if (stored.startsWith(VERIFIER_PREFIX)) {
      if (!current) return false;
      const [, len, salt, mac] = stored.split('$');
      if (String(clean.length) !== len) return false;
      const expected = CryptoJS.HmacSHA256(`${scope}|${salt}|${clean}`, current.verifierKey).toString(CryptoJS.enc.Hex);
      return safeEqual(expected, mac);
    }
    return safeEqual(CryptoService.hashPin(clean), stored);
  },

  /**
   * Finds the 4-digit PIN behind a legacy hash by trying all 10,000, so the
   * hash can be replaced without asking the user for a PIN they may never
   * type again. Yields between batches to keep the screen responsive.
   */
  async recoverLegacyPin(stored: string): Promise<string | null> {
    if (!this.isLegacyHash(stored)) return null;
    for (let base = 0; base < 10000; base += 250) {
      for (let n = base; n < base + 250; n++) {
        const pin = String(n).padStart(4, '0');
        if (CryptoService.hashPin(pin) === stored) return pin;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return null;
  },
};
