import * as SQLite from 'expo-sqlite';
import { User, Tab, Document, DiaryEntry, Note } from '../models';

export class DatabaseHelper {
  private static db: SQLite.SQLiteDatabase | null = null;

  static async getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) return this.db;
    this.db = await SQLite.openDatabaseAsync('ewallet_vault.db');
    await this.initDB(this.db);
    return this.db;
  }

  private static async initDB(db: SQLite.SQLiteDatabase) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS users (
        uuid TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        pinHash TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS tabs (
        uuid TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        isSensitive INTEGER NOT NULL DEFAULT 0,
        tabPinHash TEXT,
        createdAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tabId TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        encryptedContent TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (tabId) REFERENCES tabs (uuid) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS diary_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        entryDate TEXT NOT NULL,
        encryptedContent TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      -- One page per calendar day, so the date is what upserts key on
      CREATE UNIQUE INDEX IF NOT EXISTS idx_diary_user_date
        ON diary_entries (userId, entryDate);

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        title TEXT NOT NULL,
        encryptedContent TEXT NOT NULL,
        isSensitive INTEGER NOT NULL DEFAULT 0,
        notePinHash TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      -- Per-user key/value, currently only the diary's PIN settings
      CREATE TABLE IF NOT EXISTS app_settings (
        userId TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (userId, key)
      );
    `);

    await this.migrate(db);
  }

  /**
   * Columns added after a table shipped. SQLite has no `ADD COLUMN IF NOT
   * EXISTS`, so each one is checked against the table's actual columns first.
   */
  private static async migrate(db: SQLite.SQLiteDatabase) {
    const additions: { table: string; column: string; definition: string }[] = [
      { table: 'notes', column: 'isSensitive', definition: 'INTEGER NOT NULL DEFAULT 0' },
      { table: 'notes', column: 'notePinHash', definition: 'TEXT' },
      { table: 'documents', column: 'encryptedMeta', definition: 'TEXT' },
    ];

    for (const { table, column, definition } of additions) {
      try {
        const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
        if (!columns.some(c => c.name === column)) {
          await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
        }
      } catch (e) {
        // A missing table is created above, so there is nothing to migrate
      }
    }
  }

  // --- USER OPERATIONS ---
  static async createUser(user: User): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO users (uuid, username, pinHash, createdAt) VALUES (?, ?, ?, ?)',
      [user.uuid, user.username, user.pinHash, user.createdAt]
    );
  }

  static async getUser(uuid: string): Promise<User | null> {
    const db = await this.getDatabase();
    const result = await db.getFirstAsync<User>('SELECT * FROM users WHERE uuid = ?', [uuid]);
    return result || null;
  }

  static async getAllUsers(): Promise<User[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<User>('SELECT * FROM users ORDER BY createdAt DESC');
  }

  static async updateUser(uuid: string, username: string, pinHash: string): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'UPDATE users SET username = ?, pinHash = ? WHERE uuid = ?',
      [username, pinHash, uuid]
    );
  }

  // --- TAB OPERATIONS ---
  static async createTab(tab: Tab): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO tabs (uuid, userId, name, description, isSensitive, tabPinHash, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [tab.uuid, tab.userId, tab.name, tab.description || '', tab.isSensitive, tab.tabPinHash || null, tab.createdAt]
    );
  }

  static async getTabs(userId: string): Promise<Tab[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<Tab>('SELECT * FROM tabs WHERE userId = ? ORDER BY createdAt DESC', [userId]);
  }

  static async deleteTab(uuid: string): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync('DELETE FROM documents WHERE tabId = ?', [uuid]);
    await db.runAsync('DELETE FROM tabs WHERE uuid = ?', [uuid]);
  }

  static async updateTab(uuid: string, name: string, description: string, isSensitive: number, tabPinHash: string | null): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'UPDATE tabs SET name = ?, description = ?, isSensitive = ?, tabPinHash = ? WHERE uuid = ?',
      [name, description, isSensitive, tabPinHash, uuid]
    );
  }

  // --- DOCUMENT OPERATIONS ---
  static async createDocument(doc: Document): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'INSERT INTO documents (tabId, title, type, encryptedContent, encryptedMeta, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      [doc.tabId, doc.title, doc.type, doc.encryptedContent || '', doc.encryptedMeta ?? null, doc.createdAt]
    );
  }

  /**
   * Summary rows only. Selecting the payload here would pull every file in the
   * tab into memory just to draw a list of names, which is what made a tab of
   * large PDFs take so long to open.
   */
  static async getDocumentsByTab(tabId: string): Promise<Document[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<Document>(
      `SELECT id, tabId, title, type, createdAt, encryptedMeta,
              length(encryptedContent) AS contentLength
         FROM documents WHERE tabId = ? ORDER BY createdAt DESC`,
      [tabId]
    );
  }

  /** Whole rows, payload included. Used by the backup, which needs the files. */
  static async getDocumentsForBackup(tabIds: string[]): Promise<Document[]> {
    if (tabIds.length === 0) return [];
    const db = await this.getDatabase();
    const placeholders = tabIds.map(() => '?').join(',');
    return await db.getAllAsync<Document>(
      `SELECT * FROM documents WHERE tabId IN (${placeholders}) ORDER BY createdAt DESC`,
      tabIds
    );
  }

  /** The payload for one document, read only when something opens it. */
  static async getDocumentContent(id: number): Promise<string> {
    const db = await this.getDatabase();
    const row = await db.getFirstAsync<{ encryptedContent: string }>(
      'SELECT encryptedContent FROM documents WHERE id = ?',
      [id]
    );
    return row?.encryptedContent || '';
  }

  /** Fills in the summary for a document saved before there was one. */
  static async setDocumentMeta(id: number, encryptedMeta: string): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync('UPDATE documents SET encryptedMeta = ? WHERE id = ?', [encryptedMeta, id]);
  }

  static async getAllDocuments(): Promise<Document[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<Document>('SELECT * FROM documents ORDER BY createdAt DESC');
  }

  static async deleteDocument(id: number): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync('DELETE FROM documents WHERE id = ?', [id]);
  }

  static async updateDocument(id: number, title: string, encryptedContent: string, encryptedMeta: string | null = null): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'UPDATE documents SET title = ?, encryptedContent = ?, encryptedMeta = ? WHERE id = ?',
      [title, encryptedContent, encryptedMeta, id]
    );
  }

  static async getTabDocumentCounts(): Promise<Record<string, number>> {
    const db = await this.getDatabase();
    const rows = await db.getAllAsync<{ tabId: string; count: number }>(
      'SELECT tabId, COUNT(*) as count FROM documents GROUP BY tabId'
    );
    const counts: Record<string, number> = {};
    rows.forEach(r => {
      counts[r.tabId] = r.count;
    });
    return counts;
  }


  // --- DIARY OPERATIONS ---
  /** Writes the page for a day, replacing whatever was there before. */
  static async upsertDiaryEntry(entry: DiaryEntry): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      `INSERT INTO diary_entries (userId, entryDate, encryptedContent, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userId, entryDate)
       DO UPDATE SET encryptedContent = excluded.encryptedContent, updatedAt = excluded.updatedAt`,
      [entry.userId, entry.entryDate, entry.encryptedContent, entry.createdAt, entry.updatedAt]
    );
  }

  static async getDiaryEntry(userId: string, entryDate: string): Promise<DiaryEntry | null> {
    const db = await this.getDatabase();
    const row = await db.getFirstAsync<DiaryEntry>(
      'SELECT * FROM diary_entries WHERE userId = ? AND entryDate = ?',
      [userId, entryDate]
    );
    return row || null;
  }

  /** Just the dates that have content, for marking days in the navigator. */
  static async getDiaryDates(userId: string): Promise<string[]> {
    const db = await this.getDatabase();
    const rows = await db.getAllAsync<{ entryDate: string }>(
      'SELECT entryDate FROM diary_entries WHERE userId = ? ORDER BY entryDate DESC',
      [userId]
    );
    return rows.map(r => r.entryDate);
  }

  /** Every page, content included, for the backup. */
  static async getDiaryEntries(userId: string): Promise<DiaryEntry[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<DiaryEntry>(
      'SELECT * FROM diary_entries WHERE userId = ? ORDER BY entryDate DESC',
      [userId]
    );
  }

  static async deleteDiaryEntry(userId: string, entryDate: string): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync('DELETE FROM diary_entries WHERE userId = ? AND entryDate = ?', [userId, entryDate]);
  }

  // --- NOTE OPERATIONS ---
  static async createNote(note: Note): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'INSERT INTO notes (userId, title, encryptedContent, isSensitive, notePinHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [note.userId, note.title, note.encryptedContent, note.isSensitive, note.notePinHash || null, note.createdAt, note.updatedAt]
    );
  }

  static async getNotes(userId: string): Promise<Note[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<Note>('SELECT * FROM notes WHERE userId = ? ORDER BY updatedAt DESC', [userId]);
  }

  static async updateNote(
    id: number,
    title: string,
    encryptedContent: string,
    isSensitive: number,
    notePinHash: string | null,
    updatedAt: string
  ): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'UPDATE notes SET title = ?, encryptedContent = ?, isSensitive = ?, notePinHash = ?, updatedAt = ? WHERE id = ?',
      [title, encryptedContent, isSensitive, notePinHash, updatedAt, id]
    );
  }

  static async deleteNote(id: number): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
  }

  // --- SETTINGS OPERATIONS ---
  static async getSetting(userId: string, key: string): Promise<string | null> {
    const db = await this.getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE userId = ? AND key = ?',
      [userId, key]
    );
    return row ? row.value : null;
  }

  /**
   * Every setting for a user. The diary's PIN mode and hash live here, so a
   * backup that left them out would restore a diary with its lock removed.
   */
  static async getAllSettings(userId: string): Promise<{ key: string; value: string | null }[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<{ key: string; value: string | null }>(
      'SELECT key, value FROM app_settings WHERE userId = ?',
      [userId]
    );
  }

  static async setSetting(userId: string, key: string, value: string | null): Promise<void> {
    const db = await this.getDatabase();
    if (value === null) {
      await db.runAsync('DELETE FROM app_settings WHERE userId = ? AND key = ?', [userId, key]);
      return;
    }
    await db.runAsync(
      `INSERT INTO app_settings (userId, key, value) VALUES (?, ?, ?)
       ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value`,
      [userId, key, value]
    );
  }

  // --- SYSTEM OPERATIONS ---
  static async clearAllData(): Promise<void> {
    const db = await this.getDatabase();
    await db.execAsync(`
      DELETE FROM documents;
      DELETE FROM diary_entries;
      DELETE FROM notes;
      DELETE FROM app_settings;
      DELETE FROM tabs;
      DELETE FROM users;
    `);
  }
}
