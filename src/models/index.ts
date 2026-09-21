export interface User {
  uuid: string;
  username: string;
  pinHash: string;
  createdAt: string;
}

export interface Tab {
  uuid: string;
  userId: string;
  name: string;
  description: string;
  isSensitive: number; // 0 or 1 in SQLite
  tabPinHash?: string | null;
  createdAt: string;
}

export interface Document {
  id?: number;
  tabId: string;
  title: string;
  type: string;
  encryptedContent: string;
  createdAt: string;
}

/** One diary page, keyed by calendar day. `entryDate` is ISO `YYYY-MM-DD`. */
export interface DiaryEntry {
  id?: number;
  userId: string;
  entryDate: string;
  encryptedContent: string;
  createdAt: string;
  updatedAt: string;
}

/** A free-form note, independent of any date. */
export interface Note {
  id?: number;
  userId: string;
  title: string;
  encryptedContent: string;
  /** 0 or 1 in SQLite, mirroring how Tab stores the same flag. */
  isSensitive: number;
  notePinHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Which tab the app opens on. */
export type HomeTab = 'files' | 'diary' | 'notes';

/** How the Diary tab is protected, if at all. */
export type DiaryPinMode = 'none' | 'custom' | 'app';
