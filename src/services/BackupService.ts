import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { DatabaseHelper } from './DatabaseHelper';
import { CryptoService } from './CryptoService';
import { User, Tab, Document } from '../models';

export interface BackupData {
  version: 'ewallet_v1';
  timestamp: string;
  user: User;
  tabs: Tab[];
  documents: Document[];
}

export class BackupService {
  /**
   * Export all user tabs and documents encrypted with a user-provided 4-digit PIN
   */
  static async exportBackup(user: User, exportPin: string): Promise<boolean> {
    if (!user || exportPin.trim().length !== 4) return false;

    try {
      const tabs = await DatabaseHelper.getTabs(user.uuid);
      const allDocs: Document[] = [];

      for (const tab of tabs) {
        const docs = await DatabaseHelper.getDocumentsByTab(tab.uuid);
        allDocs.push(...docs);
      }

      const backupPayload: BackupData = {
        version: 'ewallet_v1',
        timestamp: new Date().toISOString(),
        user,
        tabs,
        documents: allDocs,
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
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'Export OfflineLocker Encrypted Backup',
          UTI: 'public.data',
        });
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
  static async importBackup(encryptedContent: string, importPin: string): Promise<{ success: boolean; tabsCount: number; docsCount: number; user: User }> {
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

      // 1. Restore User
      await DatabaseHelper.createUser(payload.user);

      // 2. Restore Tabs
      for (const tab of payload.tabs) {
        await DatabaseHelper.createTab(tab);
      }

      // 3. Restore Documents
      if (Array.isArray(payload.documents)) {
        for (const doc of payload.documents) {
          await DatabaseHelper.createDocument(doc);
        }
      }

      return {
        success: true,
        tabsCount: payload.tabs.length,
        docsCount: payload.documents ? payload.documents.length : 0,
        user: payload.user,
      };
    } catch (error: any) {
      console.error('Import backup error:', error);
      throw error;
    }
  }
}
