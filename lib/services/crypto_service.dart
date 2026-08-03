import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:encrypt/encrypt.dart' as enc;

class CryptoService {
  /// Hash a user PIN or secondary tab PIN using SHA-256 with a salt
  static String hashPin(String pin, {String salt = 'ewallet_secure_salt_2026'}) {
    final bytes = utf8.encode('$pin:$salt');
    final digest = sha256.convert(bytes);
    return digest.toString();
  }

  /// Verify if a candidate PIN matches an existing hash
  static bool verifyPin(String candidatePin, String storedHash, {String salt = 'ewallet_secure_salt_2026'}) {
    final candidateHash = hashPin(candidatePin, salt: salt);
    return candidateHash == storedHash;
  }

  /// Generate an encryption key from a user PIN or master key string
  static enc.Key _getKeyFromPin(String pin) {
    // Hash the pin to get a consistent 32-byte (256-bit) key
    final digest = sha256.convert(utf8.encode(pin));
    return enc.Key(Uint8List.fromList(digest.bytes));
  }

  /// Encrypt plaintext (e.g. document content, notes, or receipt text) using AES-256
  static String encryptText(String plainText, String pinKey) {
    try {
      final key = _getKeyFromPin(pinKey);
      final iv = enc.IV.fromLength(16); // Using a standard zero/fixed IV or random IV prepended
      final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.cbc));
      final encrypted = encrypter.encrypt(plainText, iv: iv);
      // Return IV + Ciphertext in base64
      return '${iv.base64}:${encrypted.base64}';
    } catch (e) {
      return plainText; // Fallback or handle error
    }
  }

  /// Decrypt ciphertext back to plaintext using AES-256
  static String decryptText(String cipherText, String pinKey) {
    try {
      if (!cipherText.contains(':')) return cipherText; // Not encrypted or old format
      final parts = cipherText.split(':');
      final iv = enc.IV.fromBase64(parts[0]);
      final encrypted = enc.Encrypted.fromBase64(parts[1]);
      final key = _getKeyFromPin(pinKey);
      final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.cbc));
      return encrypter.decrypt(encrypted, iv: iv);
    } catch (e) {
      return '⚠️ Decryption Failed: Invalid Key or Corrupted Data';
    }
  }
}
