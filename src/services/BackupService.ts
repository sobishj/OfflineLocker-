import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { DatabaseHelper } from './DatabaseHelper';
import { CryptoService } from './CryptoService';
import { withoutAutoLock } from './AutoLockService';
import { User, Tab, Document, DiaryEntry, Note } from '../models';

/** A setting as it is carried in a backup, without the user id. */
export interface BackupSetting {
  key: string;
  value: string | null;
}

/**
 * The version stays at v1 even though diary pages, notes and settings were
 * added later: they are separate, optional fields, so a newer backup still
 * restores in an older build (minus the new parts) and an older backup still
 * restores here. Bumping it would have broken both directions for no gain.
 */
export interface BackupData {
  version: 'ewallet_v1';
  timestamp: string;
  user: User;
  tabs: Tab[];
  documents: Document[];
  diaryEntries?: DiaryEntry[];
  notes?: Note[];
  settings?: BackupSetting[];
}

export class BackupService {
  /**
   * Everything the vault holds - files, diary pages and notes - encrypted with a
   * user-provided 4-digit PIN.
   */
  static async exportBackup(user: User, exportPin: string): Promise<boolean> {
    if (!user || exportPin.trim().length !== 4) return false;

    try {
      const tabs = await DatabaseHelper.getTabs(user.uuid);
      // Whole rows: the list query leaves the files out, and a backup without
      // them would restore every document empty
      const allDocs = await DatabaseHelper.getDocumentsForBackup(tabs.map(t => t.uuid));
      const diaryEntries = await DatabaseHelper.getDiaryEntries(user.uuid);
      const notes = await DatabaseHelper.getNotes(user.uuid);
      const settings = await DatabaseHelper.getAllSettings(user.uuid);

      const backupPayload: BackupData = {
        version: 'ewallet_v1',
        timestamp: new Date().toISOString(),
        user,
        tabs,
        documents: allDocs,
        diaryEntries,
        notes,
        settings,
      };

      const jsonStr = JSON.stringify(backupPayload);
      const encryptedData = CryptoService.encryptText(jsonStr, exportPin.trim());

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
   * Import and decrypt backup file using the user-provided 4-digit PIN
   */
  static async importBackup(encryptedContent: string, importPin: string): Promise<{ success: boolean; tabsCount: number; docsCount: number; diaryCount: number; notesCount: number; user: User }> {
    if (!encryptedContent || importPin.trim().length !== 4) {
      throw new Error('Please enter the 4-digit PIN used to create the backup.');
    }

    try {
      const decryptedJson = CryptoService.decryptText(encryptedContent.trim(), importPin.trim());

      if (!decryptedJson || !decryptedJson.startsWith('{')) {
        throw new Error('Incorrect PIN or corrupted backup file.');
      }

      let payload: BackupData;
      try {
        payload = JSON.parse(decryptedJson);
      } catch (e) {
        throw new Error('Incorrect PIN or invalid file format.');
      }

      if (!payload || payload.version !== 'ewallet_v1' || !payload.user || !Array.isArray(payload.tabs)) {
        throw new Error('Unrecognized backup file format.');
      }

      // Clear existing data before restoring backup to prevent duplicate/multiplied files or tabs
      await DatabaseHelper.clearAllData();

      // 1. Restore User
      await DatabaseHelper.createUser(payload.user);

      // 2. Restore Tabs (deduplicating tab names if any exist)
      const seenTabNames = new Set<string>();
      const validTabIds = new Set<string>();
      for (const tab of payload.tabs) {
        const tabKey = (tab.name || '').trim().toLowerCase();
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
          const docKey = `${doc.tabId}:::${(doc.title || '').trim().toLowerCase()}`;
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
          await DatabaseHelper.upsertDiaryEntry({ ...entry, userId: payload.user.uuid });
          restoredDiaryCount++;
        }
      }

      // 5. Restore notes, dropping repeats of the same title
      let restoredNotesCount = 0;
      if (Array.isArray(payload.notes)) {
        const seenNoteTitles = new Set<string>();
        for (const note of payload.notes) {
          if (!note) continue;
          const noteKey = (note.title || '').trim().toLowerCase();
          if (noteKey && seenNoteTitles.has(noteKey)) continue;
          if (noteKey) seenNoteTitles.add(noteKey);
          await DatabaseHelper.createNote({
            ...note,
            id: undefined,
            userId: payload.user.uuid,
            isSensitive: note.isSensitive ? 1 : 0,
          });
          restoredNotesCount++;
        }
      }

      // 6. Restore settings, which is where the diary's PIN lives
      if (Array.isArray(payload.settings)) {
        for (const setting of payload.settings) {
          if (!setting?.key) continue;
          await DatabaseHelper.setSetting(payload.user.uuid, setting.key, setting.value ?? null);
        }
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
