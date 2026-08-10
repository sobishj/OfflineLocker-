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
    // We use SHA256 which outputs a 256-bit WordArray directly compatible with AES
    return CryptoJS.SHA256(pin);
  }

  /**
   * Encrypt plaintext using AES-256
   */
  static encryptText(plainText: string, pinKey: string): string {
    try {
      // If it's already encrypted, don't double encrypt
      if (plainText.startsWith('ENC::')) return plainText;

      const key = this.getKeyFromPin(pinKey);
      const iv = CryptoJS.lib.WordArray.create([0, 0, 0, 0]);
      
      const encrypted = CryptoJS.AES.encrypt(plainText, key, { iv: iv });
      
      const ivBase64 = iv.toString(CryptoJS.enc.Base64);
      const cipherBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
      
      return `ENC::${ivBase64}:${cipherBase64}`;
    } catch (e) {
      console.error('Encryption failed (possibly too large)', e);
      return plainText; // Fallback to raw text if too large for JS to handle
    }
  }

  /**
   * Decrypt ciphertext back to plaintext using AES-256
   */
  static decryptText(cipherText: string, pinKey: string): string {
    try {
      // Strictly check for the ENC:: prefix. If missing, it's either raw text (fallback) or old format.
      if (!cipherText.startsWith('ENC::')) {
        // Handle old format which was just iv:ciphertext without ENC:: prefix
        // We know old format has exactly one colon, and doesn't start with data: (data URIs have multiple colons)
        if (cipherText.includes(':') && !cipherText.startsWith('data:') && !cipherText.startsWith('[')) {
           // Might be old format, let it fall through to try decrypting
           cipherText = 'ENC::' + cipherText; 
        } else {
           return cipherText;
        }
      }
      
      const payload = cipherText.substring(5); // Remove 'ENC::'
      const parts = payload.split(':');
      if (parts.length !== 2) return cipherText;

      const iv = CryptoJS.enc.Base64.parse(parts[0]);
      const ciphertext = CryptoJS.enc.Base64.parse(parts[1]);
      
      const key = this.getKeyFromPin(pinKey);
      
      const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: ciphertext
      });
      
      const decrypted = CryptoJS.AES.decrypt(cipherParams, key, { iv: iv });
      
      let result = '';
      try {
        // Fast-path: Latin1 decoding is 10x faster for Base64 image/PDF/JSON strings
        result = decrypted.toString(CryptoJS.enc.Latin1);
        if (result && (result.startsWith('data:') || result.startsWith('[') || result.startsWith('{'))) {
          return result;
        }
      } catch (e) {}

      try {
        const utf8Result = decrypted.toString(CryptoJS.enc.Utf8);
        if (utf8Result) return utf8Result;
      } catch (utf8Error) {}
      
      if (!result) throw new Error('Decryption resulted in empty string');
      return result;
    } catch (e) {
      console.error('Decryption failed', e);
      return '⚠️ Decryption Failed: Invalid Key or Corrupted Data';
    }
  }
}
