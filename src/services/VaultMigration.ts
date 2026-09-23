import { DatabaseHelper } from './DatabaseHelper';
import { VaultCrypto, DECRYPTION_FAILED } from './VaultCrypto';

/**
 * Rewrites a vault from the old format (AES-CBC under the PIN hash kept in the
 * database) into version 3, one row at a time in the background, so opening
 * the app after the update is no slower than before.
 *
 * Nothing is lost along the way: a row is only replaced once its old content
 * has decrypted, and until everything is done the old keys are kept - sealed
 * under the new vault key, not in the clear - so older rows still open.
 */

/** Payloads above this many characters are only rewritten when opened, or before a backup. */
export const MIGRATION_INLINE_LIMIT = 512 * 1024;

const LEGACY_SETTING = 'vault_legacy_keys';
const DONE_SETTING = 'vault_format';
const DONE_VALUE = '3';

export interface LegacyKeys {
  /** Keys every old row may be under - in practice the old PIN hash. */
  keys: string[];
  /** Sensitive tabs whose older documents were encrypted with the tab PIN itself. */
  tabPins: Record<string, string>;
}

const EMPTY: LegacyKeys = { keys: [], tabPins: {} };

const pause = () => new Promise(resolve => setTimeout(resolve, 0));

let running: Promise<boolean> | null = null;

const failed = (plain: string) => !plain || plain === DECRYPTION_FAILED || plain.startsWith('⚠️ Decryption Failed');

export const VaultMigration = {
  /** Vault settings that must never travel in a backup or be restored from one. */
  isInternalSetting: (key: string) => key === LEGACY_SETTING || key === DONE_SETTING,

  async isComplete(userId: string): Promise<boolean> {
    return (await DatabaseHelper.getSetting(userId, DONE_SETTING)) === DONE_VALUE;
  },

  async markComplete(userId: string): Promise<void> {
    await DatabaseHelper.setSetting(userId, DONE_SETTING, DONE_VALUE);
    await DatabaseHelper.setSetting(userId, LEGACY_SETTING, null);
  },

  /**
   * The old keys, or empty when there are none. Throws LEGACY_UNREADABLE when
   * they exist but cannot be opened: treating that as "none" and saving over
   * it would throw away the only key some older rows can be read with.
   */
  async loadLegacyKeys(userId: string): Promise<LegacyKeys> {
    const sealed = await DatabaseHelper.getSetting(userId, LEGACY_SETTING);
    if (!sealed) return { ...EMPTY, tabPins: {} };
    let parsed: any;
    try {
      parsed = JSON.parse(await VaultCrypto.decrypt(sealed));
    } catch {
      throw new Error('LEGACY_UNREADABLE');
    }
    return {
      keys: Array.isArray(parsed?.keys) ? parsed.keys : [],
      tabPins: parsed?.tabPins && typeof parsed.tabPins === 'object' ? parsed.tabPins : {},
    };
  },

  /** Adds to the stored old keys; a key once saved is only removed by markComplete. */
  async saveLegacyKeys(userId: string, legacy: LegacyKeys): Promise<void> {
    let stored: LegacyKeys;
    try {
      stored = await this.loadLegacyKeys(userId);
    } catch {
      // Unreadable: refuse to write over it
      return;
    }
    const merged: LegacyKeys = {
      keys: Array.from(new Set([...stored.keys, ...legacy.keys].filter(Boolean))),
      tabPins: { ...stored.tabPins, ...legacy.tabPins },
    };
    await DatabaseHelper.setSetting(userId, LEGACY_SETTING, await VaultCrypto.encrypt(JSON.stringify(merged)));
  },

  /**
   * Runs the migration if it is not already running. `includeLarge` also takes
   * the big payloads, which a backup needs; otherwise they wait until opened.
   * Resolves true once nothing in the old format is left.
   */
  run(userId: string, options: { includeLarge?: boolean } = {}): Promise<boolean> {
    if (running) {
      // A backup asking for everything must not settle for a lighter pass in progress
      if (!options.includeLarge) return running;
      return running.then(() => this.run(userId, options));
    }
    running = migrate(userId, !!options.includeLarge).finally(() => { running = null; });
    return running;
  },
};

async function migrate(userId: string, includeLarge: boolean): Promise<boolean> {
  if (!VaultCrypto.isOpen() || VaultCrypto.openUserId() !== userId) return false;
  if (await VaultMigration.isComplete(userId)) return true;

  let legacy: LegacyKeys;
  try {
    legacy = await VaultMigration.loadLegacyKeys(userId);
  } catch {
    // Leave everything as it is rather than risk dropping a key
    return false;
  }
  // Whatever the open vault already knows counts too
  legacy.keys = Array.from(new Set([...legacy.keys, ...VaultCrypto.legacyKeys()]));
  let remaining = 0;
  let legacyChanged = false;

  const upgradeHash = async (stored: string | null | undefined, scope: 'app' | 'tab' | 'note' | 'diary') => {
    if (!VaultCrypto.isLegacyHash(stored)) return { hash: stored ?? null, pin: null as string | null };
    const pin = await VaultCrypto.recoverLegacyPin(stored!);
    if (!pin) {
      remaining++;
      return { hash: stored ?? null, pin: null };
    }
    return { hash: VaultCrypto.makeVerifier(pin, scope), pin };
  };

  // --- The account PIN ---
  const user = (await DatabaseHelper.getAllUsers()).find(u => u.uuid === userId);
  if (user && VaultCrypto.isLegacyHash(user.pinHash)) {
    const { hash } = await upgradeHash(user.pinHash, 'app');
    if (hash && hash !== user.pinHash) await DatabaseHelper.setUserPinHash(userId, hash);
  }

  // --- Tabs: names, descriptions, PINs ---
  const tabs = await DatabaseHelper.getTabs(userId);
  for (const tab of tabs) {
    await pause();
    let name = tab.name;
    let description = tab.description || '';
    let changed = false;
    if (name && !VaultCrypto.isCurrentFormat(name)) { name = await VaultCrypto.encrypt(name); changed = true; }
    if (description && !VaultCrypto.isCurrentFormat(description)) { description = await VaultCrypto.encrypt(description); changed = true; }
    const { hash, pin } = await upgradeHash(tab.tabPinHash, 'tab');
    if (hash !== (tab.tabPinHash ?? null)) changed = true;
    // Its older documents may be under this PIN, so it is kept until they are rewritten
    if (pin && legacy.tabPins[tab.uuid] !== pin) {
      legacy.tabPins[tab.uuid] = pin;
      legacyChanged = true;
    }
    if (changed) await DatabaseHelper.setTabFields(tab.uuid, name, description, hash);
  }
  if (legacyChanged) await VaultMigration.saveLegacyKeys(userId, legacy);

  // --- Documents ---
  const docs = await DatabaseHelper.getDocumentsForMigration();
  const tabIds = new Set(tabs.map(t => t.uuid));
  for (const doc of docs) {
    if (!tabIds.has(doc.tabId)) continue;
    await pause();
    const extra = [legacy.tabPins[doc.tabId]];

    if (doc.title && !VaultCrypto.isCurrentFormat(doc.title)) {
      await DatabaseHelper.setDocumentTitle(doc.id, await VaultCrypto.encrypt(doc.title));
    }
    if (doc.encryptedMeta && !VaultCrypto.isCurrentFormat(doc.encryptedMeta)) {
      const meta = await VaultCrypto.decrypt(doc.encryptedMeta, extra);
      if (!failed(meta)) await DatabaseHelper.setDocumentMeta(doc.id, await VaultCrypto.encrypt(meta));
      else remaining++;
    }
    if (doc.contentLength > 0 && !(doc.contentHead || '').startsWith('ENC3:')) {
      if (doc.contentLength > MIGRATION_INLINE_LIMIT && !includeLarge) {
        remaining++;
        continue;
      }
      const cipher = await DatabaseHelper.getDocumentContent(doc.id);
      const plain = await VaultCrypto.decrypt(cipher, extra);
      if (failed(plain)) { remaining++; continue; }
      await DatabaseHelper.setDocumentContent(doc.id, await VaultCrypto.encrypt(plain));
    }
  }

  // --- Notes ---
  const notes = await DatabaseHelper.getNotes(userId);
  for (const note of notes) {
    if (note.id == null) continue;
    await pause();
    let title = note.title;
    let content = note.encryptedContent;
    let changed = false;
    if (title && !VaultCrypto.isCurrentFormat(title)) { title = await VaultCrypto.encrypt(title); changed = true; }
    if (content && !VaultCrypto.isCurrentFormat(content)) {
      const plain = await VaultCrypto.decrypt(content);
      if (failed(plain)) remaining++;
      else { content = await VaultCrypto.encrypt(plain); changed = true; }
    }
    const { hash } = await upgradeHash(note.notePinHash, 'note');
    if (hash !== (note.notePinHash ?? null)) changed = true;
    if (changed) await DatabaseHelper.setNoteFields(note.id, title, content, hash);
  }

  // --- Diary pages and the diary's own PIN ---
  const entries = await DatabaseHelper.getDiaryEntries(userId);
  for (const entry of entries) {
    if (!entry.encryptedContent || VaultCrypto.isCurrentFormat(entry.encryptedContent)) continue;
    await pause();
    const plain = await VaultCrypto.decrypt(entry.encryptedContent);
    if (failed(plain)) { remaining++; continue; }
    await DatabaseHelper.setDiaryContent(userId, entry.entryDate, await VaultCrypto.encrypt(plain));
  }
  const diaryHash = await DatabaseHelper.getSetting(userId, 'diary_pin_hash');
  if (VaultCrypto.isLegacyHash(diaryHash)) {
    const { hash } = await upgradeHash(diaryHash, 'diary');
    if (hash && hash !== diaryHash) await DatabaseHelper.setSetting(userId, 'diary_pin_hash', hash);
  }

  if (remaining === 0) {
    await VaultMigration.markComplete(userId);
    VaultCrypto.setLegacyKeys([]);
    return true;
  }
  return false;
}
