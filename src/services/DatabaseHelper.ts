import * as SQLite from 'expo-sqlite';
import { User, Tab, Document } from '../models';

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
    `);
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

  static async updateTab(uuid: string, name: string, description: string): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'UPDATE tabs SET name = ?, description = ? WHERE uuid = ?',
      [name, description, uuid]
    );
  }

  // --- DOCUMENT OPERATIONS ---
  static async createDocument(doc: Document): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync(
      'INSERT INTO documents (tabId, title, type, encryptedContent, createdAt) VALUES (?, ?, ?, ?, ?)',
      [doc.tabId, doc.title, doc.type, doc.encryptedContent, doc.createdAt]
    );
  }

  static async getDocumentsByTab(tabId: string): Promise<Document[]> {
    const db = await this.getDatabase();
    return await db.getAllAsync<Document>('SELECT * FROM documents WHERE tabId = ? ORDER BY createdAt DESC', [tabId]);
  }

  static async deleteDocument(id: number): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync('DELETE FROM documents WHERE id = ?', [id]);
  }

  static async updateDocument(id: number, title: string, encryptedContent: string): Promise<void> {
    const db = await this.getDatabase();
    await db.runAsync('UPDATE documents SET title = ?, encryptedContent = ? WHERE id = ?', [title, encryptedContent, id]);
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

  // --- SYSTEM OPERATIONS ---
  static async clearAllData(): Promise<void> {
    const db = await this.getDatabase();
    await db.execAsync(`
      DELETE FROM documents;
      DELETE FROM tabs;
      DELETE FROM users;
    `);
  }
}
