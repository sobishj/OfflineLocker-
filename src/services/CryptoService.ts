import CryptoJS from 'crypto-js';

const SALT = 'ewallet_secure_salt_2026';

export class CryptoService {
  /**
   * Hash a user PIN or secondary tab PIN using SHA-256 with a salt
   */
  static hashPin(pin: string, salt: string = SALT): string {
    const message = `${pin}:${salt}`;
    return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);
  }

  /**
   * Verify if a candidate PIN matches an existing hash
   */
  static verifyPin(candidatePin: string, storedHash: string, salt: string = SALT): boolean {
    const candidateHash = this.hashPin(candidatePin, salt);
    return candidateHash === storedHash;
  }

  /**
   * Generate an encryption key from a user PIN string
   */
  private static getKeyFromPin(pin: string) {
    // Hash the pin to get a consistent 32-byte (256-bit) key
    return CryptoJS.SHA256(pin);
  }

  /**
   * Encrypt plaintext using AES-256
   */
  static encryptText(plainText: string, pinKey: string): string {
    try {
      if (!plainText) return '';
      // If it's already encrypted, don't double encrypt
      if (plainText.startsWith('ENC::') || plainText.startsWith('ENC_V2::')) return plainText;

      const key = this.getKeyFromPin(pinKey);
      const iv = CryptoJS.lib.WordArray.create([0, 0, 0, 0]);
      
      const encrypted = CryptoJS.AES.encrypt(plainText, key, { iv: iv });
      
      const ivBase64 = iv.toString(CryptoJS.enc.Base64);
      const cipherBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
      
      return `ENC::${ivBase64}:${cipherBase64}`;
    } catch (e) {
      console.error('Encryption failed (possibly too large)', e);
      return plainText; // Fallback to raw text if error
    }
  }

  /**
   * Decrypt ciphertext back to plaintext using AES-256 with fast single-pass fallback
   */
  static decryptText(cipherText: string, pinKey: string): string {
    try {
      if (!cipherText) return '';

      // Strictly check for the ENC:: or ENC_V2:: prefix. If missing, it's raw text or old format.
      if (!cipherText.startsWith('ENC::') && !cipherText.startsWith('ENC_V2::')) {
        if (cipherText.includes(':') && !cipherText.startsWith('data:') && !cipherText.startsWith('[')) {
           cipherText = 'ENC::' + cipherText; 
        } else {
           return cipherText;
        }
      }
      
      const isV1 = cipherText.startsWith('ENC::');
      const payload = cipherText.substring(isV1 ? 5 : 8); // Remove 'ENC::' or 'ENC_V2::'
      const parts = payload.split(':');
      if (parts.length !== 2) return cipherText;

      const iv = CryptoJS.enc.Base64.parse(parts[0]);
      const ciphertext = CryptoJS.enc.Base64.parse(parts[1]);
      
      const key = this.getKeyFromPin(pinKey);
      
      const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: ciphertext
      });
      
      const decrypted = CryptoJS.AES.decrypt(cipherParams, key, { iv: iv });
      
      // Single-pass UTF-8 decoding (valid for ASCII, JSON, Base64 data URIs, and UTF-8 text)
      try {
        const utf8Result = decrypted.toString(CryptoJS.enc.Utf8);
        if (utf8Result) return utf8Result;
      } catch (e) {}

      // Fast Latin1 fallback if UTF-8 fails (e.g. for huge base64 strings on Hermes)
      // Must be guarded against returning arbitrary binary noise from wrong AES keys
      try {
        const latin1Result = decrypted.toString(CryptoJS.enc.Latin1);
        if (
          latin1Result &&
          (latin1Result.startsWith('data:') ||
           latin1Result.startsWith('[') ||
           latin1Result.startsWith('{') ||
           /^[\x20-\x7E\r\n\t]+$/.test(latin1Result.slice(0, 100)))
        ) {
          return latin1Result;
        }
      } catch (e) {}

      throw new Error('Decryption resulted in empty string');
    } catch (e) {
      return '⚠️ Decryption Failed: Invalid Key or Corrupted Data';
    }
  }

  /**
   * Decrypt ciphertext attempting multiple candidate keys in order.
   * Returns the first successfully decrypted valid plaintext.
   */
  static decryptWithKeys(cipherText: string, pinKeys: (string | undefined | null)[]): string {
    if (!cipherText) return '';
    const keys = Array.from(new Set(pinKeys.filter((k): k is string => Boolean(k && k.trim()))));
    if (keys.length === 0) return cipherText;

    for (const key of keys) {
      const result = this.decryptText(cipherText, key);
      if (result && !result.startsWith('⚠️ Decryption Failed')) {
        return result;
      }
    }

    return '⚠️ Decryption Failed: Invalid Key or Corrupted Data';
  }
}

