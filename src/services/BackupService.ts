import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { pbkdf2Sha256 } from './Pbkdf2';
import { DatabaseHelper } from './DatabaseHelper';
import { CryptoService } from './CryptoService';
import { VaultCrypto, utf8Encode, utf8Decode, sealedFromBase64 } from './VaultCrypto';
import { VaultMigration, LegacyKeys } from './VaultMigration';
import { withoutAutoLock } from './AutoLockService';
import { User, Tab, Document, DiaryEntry, Note } from '../models';

/** A setting as it is carried in a backup, without the user id. */
export interface BackupSetting {
  key: string;
  value: string | null;
}

/**
 * Version 1, written before encryption v3: rows under the old PIN hash, the
 * whole file encrypted with a 4-digit PIN. Still restored; no longer written.
 */
export interface BackupDataV1 {
  version: 'ewallet_v1';
  timestamp: string;
  user: User;
  tabs: Tab[];
  documents: Document[];
  diaryEntries?: DiaryEntry[];
  notes?: Note[];
  settings?: BackupSetting[];
}

/**
 * Version 2: rows exactly as stored (sealed under the vault key), plus the
 * vault key itself so another device can read them. The whole file is sealed
 * with AES-256-GCM under a key stretched from the backup password.
 */
export interface BackupDataV2 {
  version: 'ewallet_v2';
  timestamp: string;
  user: User;
  vaultKey: string;
  /** Old keys still needed by rows that could not be rewritten, if any. */
  legacy?: LegacyKeys | null;
  tabs: Tab[];
  documents: Document[];
  diaryEntries: DiaryEntry[];
  notes: Note[];
  settings: BackupSetting[];
}

const V2_PREFIX = 'OLB2:';
/**
 * Iterations for the password key: about a second on a phone, in JavaScript.
 * Stored in each file, so it can be raised later without breaking old backups.
 */
const KDF_ITERATIONS = 100_000;
export const BACKUP_PASSWORD_MIN = 8;

interface V2Header {
  v: 2;
  kdf: 'pbkdf2-sha256';
  iter: number;
  salt: string;
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x2000)));
  }
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/** The file key: the password stretched with PBKDF2 so that guessing it offline is slow. */
const deriveFileKey = async (password: string, salt: Uint8Array, iterations: number) => {
  const raw = await pbkdf2Sha256(utf8Encode(password), salt, iterations);
  return Crypto.AESEncryptionKey.import(raw);
};

const sealBackup = async (json: string, password: string): Promise<string> => {
  const salt = Crypto.getRandomBytes(16);
  const header: V2Header = { v: 2, kdf: 'pbkdf2-sha256', iter: KDF_ITERATIONS, salt: toB64(salt) };
  const key = await deriveFileKey(password, salt, KDF_ITERATIONS);
  const sealed = await Crypto.aesEncryptAsync(utf8Encode(json), key);
  return `${V2_PREFIX}${btoa(JSON.stringify(header))}:${await sealed.combined('base64')}`;
};

const openBackup = async (content: string, password: string): Promise<string> => {
  const rest = content.slice(V2_PREFIX.length);
  const split = rest.indexOf(':');
  if (split < 0) throw new Error('Unrecognized backup file format.');
  let header: V2Header;
  try {
    header = JSON.parse(atob(rest.slice(0, split)));
  } catch {
    throw new Error('Unrecognized backup file format.');
  }
  if (header?.kdf !== 'pbkdf2-sha256' || !header.salt || !(header.iter > 0)) {
    throw new Error('Unrecognized backup file format.');
  }
  const key = await deriveFileKey(password, fromB64(header.salt), header.iter);
  try {
    const sealed = sealedFromBase64(rest.slice(split + 1));
    return utf8Decode(await Crypto.aesDecryptAsync(sealed, key));
  } catch {
    // An authentication failure: wrong password, or a damaged file
    throw new Error('Incorrect backup password, or the file is damaged.');
  }
};

export class BackupService {
  static isPasswordFormat(content: string): boolean {
    return content.trim().startsWith(V2_PREFIX);
  }

  /**
   * Everything the vault holds - files, diary pages and notes - sealed with the
   * backup password. `legacy` is only passed when some rows could not be brought
   * to the current format, so the keys they still need travel with them.
   */
  static async exportBackup(user: User, password: string, legacy: LegacyKeys | null): Promise<boolean> {
    if (!user || password.length < BACKUP_PASSWORD_MIN) return false;

    try {
      const tabs = await DatabaseHelper.getTabs(user.uuid);
      // Whole rows: the list query leaves the files out, and a backup without
      // them would restore every document empty
      const allDocs = await DatabaseHelper.getDocumentsForBackup(tabs.map(t => t.uuid));
      const diaryEntries = await DatabaseHelper.getDiaryEntries(user.uuid);
      const notes = await DatabaseHelper.getNotes(user.uuid);
      const settings = (await DatabaseHelper.getAllSettings(user.uuid)).filter(s => !VaultMigration.isInternalSetting(s.key));

      const backupPayload: BackupDataV2 = {
        version: 'ewallet_v2',
        timestamp: new Date().toISOString(),
        user,
        vaultKey: await VaultCrypto.exportKey(),
        legacy,
        tabs,
        documents: allDocs,
        diaryEntries,
        notes,
        settings,
      };

      const encryptedData = await sealBackup(JSON.stringify(backupPayload), password);

      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `OfflineLocker_Backup_${dateStr}.olocker`;

      if (Platform.OS === 'web') {
        const blob = new Blob([encryptedData], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        return true;
      } else {
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, encryptedData, { encoding: 'utf8' });
        await withoutAutoLock(() => Sharing.shareAsync(fileUri, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Save OfflineLocker Encrypted Backup',
          UTI: 'public.data',
        }));
        return true;
      }
    } catch (error) {
      console.error('Export backup failed:', error);
      throw error;
    }
  }

  /**
   * Restores a backup of either version, replacing the vault on this device.
   * `secret` is the backup password, or for an old backup its 4-digit PIN.
   * On success the restored vault is open.
   */
  static async importBackup(encryptedContent: string, secret: string): Promise<{ success: boolean; tabsCount: number; docsCount: number; diaryCount: number; notesCount: number; user: User }> {
    const content = (encryptedContent || '').trim();
    if (!content || !secret) {
      throw new Error('Please enter the password used to create the backup.');
    }

    try {
      let payload: BackupDataV1 | BackupDataV2;
      if (this.isPasswordFormat(content)) {
        const json = await openBackup(content, secret);
        payload = JSON.parse(json);
        if (!payload || payload.version !== 'ewallet_v2' || !(payload as BackupDataV2).vaultKey) {
          throw new Error('Unrecognized backup file format.');
        }
      } else {
        if (!/^\d{4}$/.test(secret.trim())) {
          throw new Error('This is an older backup. Enter the 4-digit PIN it was created with.');
        }
        const decryptedJson = CryptoService.decryptText(content, secret.trim());
        if (!decryptedJson || !decryptedJson.startsWith('{')) {
          throw new Error('Incorrect PIN or corrupted backup file.');
        }
        try {
          payload = JSON.parse(decryptedJson);
        } catch (e) {
          throw new Error('Incorrect PIN or invalid file format.');
        }
        if (!payload || payload.version !== 'ewallet_v1') {
          throw new Error('Unrecognized backup file format.');
        }
      }
      if (!payload.user || !Array.isArray(payload.tabs)) {
        throw new Error('Unrecognized backup file format.');
      }

      const userId = payload.user.uuid;
      let legacy: LegacyKeys;
      let formatComplete: boolean;
      if (payload.version === 'ewallet_v2') {
        legacy = payload.legacy || { keys: [], tabPins: {} };
        formatComplete = !payload.legacy;
        await VaultCrypto.adoptKey(userId, payload.vaultKey, legacy.keys);
      } else {
        // Every row of an old backup is under the old PIN hash of its account
        legacy = { keys: VaultCrypto.isLegacyHash(payload.user.pinHash) ? [payload.user.pinHash] : [], tabPins: {} };
        formatComplete = false;
        if (!(await VaultCrypto.open(userId, legacy.keys))) await VaultCrypto.create(userId, legacy.keys);
      }
      // Titles may be sealed, so repeats are found by their plaintext
      const label = async (value: string | null | undefined) => (await VaultCrypto.decryptLabel(value)).trim().toLowerCase();

      // Clear existing data before restoring backup to prevent duplicate/multiplied files or tabs
      await DatabaseHelper.clearAllData();

      // 1. Restore User
      await DatabaseHelper.createUser(payload.user);

      // 2. Restore Tabs (deduplicating tab names if any exist)
      const seenTabNames = new Set<string>();
      const validTabIds = new Set<string>();
      for (const tab of payload.tabs) {
        const tabKey = await label(tab.name);
        if (seenTabNames.has(tabKey)) {
          continue;
        }
        seenTabNames.add(tabKey);
        validTabIds.add(tab.uuid);
        await DatabaseHelper.createTab(tab);
      }

      // 3. Restore Documents (deduplicating identical titles within the same tab)
      let restoredDocsCount = 0;
      if (Array.isArray(payload.documents)) {
        const seenDocKeys = new Set<string>();
        for (const doc of payload.documents) {
          if (!validTabIds.has(doc.tabId)) continue;
          const docKey = `${doc.tabId}:::${await label(doc.title)}`;
          if (seenDocKeys.has(docKey)) {
            continue;
          }
          seenDocKeys.add(docKey);
          await DatabaseHelper.createDocument(doc);
          restoredDocsCount++;
        }
      }

      // 4. Restore diary pages. One page per day is the rule the table enforces,
      // and the upsert keeps that true whatever the file contains.
      let restoredDiaryCount = 0;
      if (Array.isArray(payload.diaryEntries)) {
        for (const entry of payload.diaryEntries) {
          if (!entry?.entryDate || !entry.encryptedContent) continue;
          await DatabaseHelper.upsertDiaryEntry({ ...entry, userId });
          restoredDiaryCount++;
        }
      }

      // 5. Restore notes, dropping repeats of the same title
      let restoredNotesCount = 0;
      if (Array.isArray(payload.notes)) {
        const seenNoteTitles = new Set<string>();
        for (const note of payload.notes) {
          if (!note) continue;
          const noteKey = await label(note.title);
          if (noteKey && seenNoteTitles.has(noteKey)) continue;
          if (noteKey) seenNoteTitles.add(noteKey);
          await DatabaseHelper.createNote({
            ...note,
            id: undefined,
            userId,
            isSensitive: note.isSensitive ? 1 : 0,
          });
          restoredNotesCount++;
        }
      }

      // 6. Restore settings, which is where the diary's PIN lives
      if (Array.isArray(payload.settings)) {
        for (const setting of payload.settings) {
          if (!setting?.key || VaultMigration.isInternalSetting(setting.key)) continue;
          await DatabaseHelper.setSetting(userId, setting.key, setting.value ?? null);
        }
      }

      // 7. The vault's own bookkeeping for the rows just written
      if (formatComplete) {
        await VaultMigration.markComplete(userId);
      } else {
        await VaultMigration.saveLegacyKeys(userId, legacy);
      }

      return {
        success: true,
        tabsCount: seenTabNames.size,
        docsCount: restoredDocsCount,
        diaryCount: restoredDiaryCount,
        notesCount: restoredNotesCount,
        user: payload.user,
      };
    } catch (error: any) {
      console.error('Import backup error:', error);
      throw error;
    }
  }
}
