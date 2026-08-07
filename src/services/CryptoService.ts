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
      const key = this.getKeyFromPin(pinKey);
      // In the original Flutter app, a zero IV of length 16 bytes was used: `enc.IV.fromLength(16)`
      // We replicate this 16-byte zero IV for compatibility: 4 words of 32 bits (0)
      const iv = CryptoJS.lib.WordArray.create([0, 0, 0, 0]);
      
      const encrypted = CryptoJS.AES.encrypt(plainText, key, { iv: iv });
      
      // Return IV + Ciphertext in base64
      const ivBase64 = iv.toString(CryptoJS.enc.Base64);
      const cipherBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
      
      return `${ivBase64}:${cipherBase64}`;
    } catch (e) {
      return plainText; // Fallback
    }
  }

  /**
   * Decrypt ciphertext back to plaintext using AES-256
   */
  static decryptText(cipherText: string, pinKey: string): string {
    try {
      if (!cipherText.includes(':')) return cipherText; // Not encrypted or old format
      
      const parts = cipherText.split(':');
      const iv = CryptoJS.enc.Base64.parse(parts[0]);
      const ciphertext = CryptoJS.enc.Base64.parse(parts[1]);
      
      const key = this.getKeyFromPin(pinKey);
      
      const cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: ciphertext
      });
      
      const decrypted = CryptoJS.AES.decrypt(cipherParams, key, { iv: iv });
      
      const result = decrypted.toString(CryptoJS.enc.Utf8);
      if (!result) throw new Error('Decryption resulted in empty string');
      
      return result;
    } catch (e) {
      return '⚠️ Decryption Failed: Invalid Key or Corrupted Data';
    }
  }
}
