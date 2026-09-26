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
  /**
   * The encrypted payload, files and all. A vault of scanned PDFs holds tens of
   * megabytes of it, so list rows leave it out and it is read per document,
   * when something actually opens one.
   */
  encryptedContent?: string;
  /**
   * A small encrypted summary - the dates and the document number - so the list
   * can show expiry without decrypting the files to find it.
   */
  encryptedMeta?: string | null;
  /** Ciphertext length, so a size can be shown without holding the bytes. */
  contentLength?: number;
  /** The summary, decrypted when the list loads. Never written to the database. */
  plainMeta?: string | null;
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
  /** The paper inside the note: a page-colour key or a custom hex. None keeps the old shared paper. */
  pageColor?: string | null;
  /** The note's card in the list: a tab-colour key or a custom hex. */
  tabColor?: string | null;
  createdAt: string;
  updatedAt: string;
  /** The text, decrypted when the list loads. Never written to the database. */
  content?: string;
  /** True when the stored text would not decrypt; it is then never written over. */
  unreadable?: boolean;
}

/** Which tab the app opens on. */
export type HomeTab = 'files' | 'diary' | 'notes';

/** How the Diary tab is protected, if at all. */
export type DiaryPinMode = 'none' | 'custom' | 'app';
