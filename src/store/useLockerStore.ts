import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values'; // Needed for uuid in React Native
import { User, Tab, Document, Note, DiaryPinMode, HomeTab } from '../models';
import { DatabaseHelper } from '../services/DatabaseHelper';
import { VaultCrypto } from '../services/VaultCrypto';
import { VaultMigration, LegacyKeys } from '../services/VaultMigration';
import { BackupService } from '../services/BackupService';
import { clearDecryptedCache } from '../services/FileCacheService';
import { BiometricService, BiometricScopes } from '../services/BiometricService';
import {
  applyAccent,
  applyBackground,
  applyBars,
  DEFAULT_ACCENT_KEY,
  DEFAULT_BAR_KEY,
  DEFAULT_CUSTOM_BAR,
  DEFAULT_BACKGROUND_KEY,
  DEFAULT_CUSTOM_ACCENT,
  DEFAULT_CUSTOM_BACKGROUND,
  DEFAULT_CUSTOM_PAPER,
  DEFAULT_PAGE_COLOR_KEY,
  CUSTOM_KEY,
} from '../theme/AppTheme';
import { StorageService } from '../utils/storage';

/** Appearance is a device preference: it has to be right on the lock screen too. */
const ACCENT_STORAGE_KEY = '@offline_locker_accent';
const ACCENT_CUSTOM_STORAGE_KEY = '@offline_locker_accent_custom';
const BACKGROUND_STORAGE_KEY = '@offline_locker_background';
const BACKGROUND_CUSTOM_STORAGE_KEY = '@offline_locker_background_custom';
const BAR_STORAGE_KEY = '@offline_locker_bar';
const BAR_CUSTOM_STORAGE_KEY = '@offline_locker_bar_custom';
import { LockoutService, LockoutState } from '../services/LockoutService';

/** Every PIN created or changed from now on. Existing 4-digit PINs keep working. */
export const NEW_PIN_LENGTH = 6;
const isNewPin = (pin?: string) => !!pin && new RegExp(`^\\d{${NEW_PIN_LENGTH}}$`).test(pin.trim());

interface LockerState {
  currentUser: User | null;
  tabs: Tab[];
  tabDocCounts: Record<string, number>;
  activeDocuments: Document[];
  isLoading: boolean;
  errorMessage: string | null;
  isAuthenticated: boolean;
  lockoutState: LockoutState | null;
  diaryDates: string[];
  notes: Note[];
  defaultHomeTab: HomeTab;
  diaryLined: boolean;
  /** Which accent the whole app is painted with. */
  accentKey: string;
  /** The colour behind 'custom', remembered even while a preset is in use. */
  customAccent: string;
  /** What the app is laid out on, behind the cards. */
  backgroundKey: string;
  customBackground: string;
  /** The header strip and the tab bar, themed as one. */
  barKey: string;
  customBar: string;
  /** The paper the diary and the note writer are drawn on. */
  diaryPageColor: string;
  customDiaryPageColor: string;
  notePageColor: string;
  customNotePageColor: string;
  /**
   * Bumped whenever the theme is repainted. Styles built by StyleSheet.create
   * hold the colours they were given, so this is what tells them to rebuild.
   */
  themeVersion: number;
  diaryPinMode: DiaryPinMode;
  diaryPinHash: string | null;
  /** False until the stored mode has been read. Treating "not yet known" as
   *  "no lock" is what let the diary show itself for a frame on the way in. */
  diaryPinLoaded: boolean;

  // Actions
  checkExistingUsers: () => Promise<void>;
  registerUser: (username: string, pin: string, biometric?: boolean) => Promise<boolean>;
  loginUser: (pin: string) => Promise<boolean>;
  /** Unlocks the vault with a scan instead of the PIN. False means ask for the PIN. */
  unlockWithBiometric: () => Promise<boolean>;
  logout: () => void;
  loadTabs: () => Promise<void>;
  createTab: (name: string, description: string, isSensitive: boolean, tabPin?: string, biometric?: boolean) => Promise<boolean>;
  /** `biometric.pin` is the tab's PIN as it stands after the edit, which is what a scan hands back. */
  updateTab: (tabId: string, name: string, description: string, isSensitive: boolean, tabPin?: string, biometric?: { enabled: boolean; pin?: string }) => Promise<boolean>;
  deleteTab: (tabId: string) => Promise<void>;
  verifyTabPin: (tab: Tab, candidatePin: string) => boolean;
  loadDocumentsForTab: (tabId: string) => Promise<void>;
  addDocument: (tabId: string, title: string, type: string, plainContent: string, plainMeta?: string) => Promise<void>;
  updateDocument: (id: number, tabId: string, title: string, plainContent: string, plainMeta?: string) => Promise<void>;
  deleteDocument: (id: number, tabId: string) => Promise<void>;
  getDocumentContent: (id: number) => Promise<string>;
  /** Plaintext of a stored value; `extraKeys` are old tab PINs some older documents are under. */
  decryptValue: (cipher: string, extraKeys?: (string | null | undefined)[]) => Promise<string>;
  /** Rewrites an old-format document payload once it has been opened and decrypted. */
  upgradeDocumentContent: (id: number, plainContent: string) => Promise<void>;
  /** The PIN an older document in this tab may be encrypted with, if known. */
  legacyTabPin: (tabId: string) => string | undefined;
  setDocumentMeta: (id: number, plainMeta: string) => Promise<void>;
  loadDiaryDates: () => Promise<void>;
  getDiaryEntry: (entryDate: string) => Promise<string>;
  saveDiaryEntry: (entryDate: string, plainContent: string) => Promise<void>;
  loadNotes: () => Promise<void>;
  /** Resolves to the new note's id, or null when it could not be saved. */
  addNote: (title: string, plainContent: string, isSensitive: boolean, notePin?: string, biometric?: boolean) => Promise<number | null>;
  /** `biometric` left undefined keeps the note's current setting. */
  updateNote: (id: number, title: string, plainContent: string, isSensitive: boolean, notePin?: string, biometric?: boolean) => Promise<void>;
  /** Either colour left undefined keeps what the note has. */
  setNoteColors: (id: number, colors: { pageColor?: string | null; tabColor?: string | null }) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  decryptNote: (note: Note) => string;
  verifyNotePin: (note: Note, candidatePin: string) => boolean;
  loadDefaultHomeTab: () => Promise<void>;
  setDefaultHomeTab: (tab: HomeTab) => Promise<void>;
  loadDiaryLined: () => Promise<void>;
  setDiaryLined: (lined: boolean) => Promise<void>;
  loadAccent: () => Promise<void>;
  setAccent: (key: string) => Promise<void>;
  setCustomAccent: (hex: string) => Promise<void>;
  setBackground: (key: string) => Promise<void>;
  setCustomBackground: (hex: string) => Promise<void>;
  setBar: (key: string) => Promise<void>;
  setCustomBar: (hex: string) => Promise<void>;
  loadPageColors: () => Promise<void>;
  setDiaryPageColor: (key: string) => Promise<void>;
  setCustomDiaryPageColor: (hex: string) => Promise<void>;
  setNotePageColor: (key: string) => Promise<void>;
  setCustomNotePageColor: (hex: string) => Promise<void>;
  loadDiaryPinMode: () => Promise<void>;
  setDiaryPin: (mode: DiaryPinMode, pin?: string, biometric?: boolean) => Promise<void>;
  setDiaryBiometric: (enabled: boolean) => Promise<void>;
  verifyDiaryPin: (candidatePin: string) => boolean;
  /** Checks the account PIN without unlocking anything, for the profile screen. */
  verifyAppPin: (candidatePin: string) => boolean;
  exportBackup: (password: string) => Promise<boolean>;
  importBackup: (encryptedContent: string, secret: string) => Promise<{ success: boolean; tabsCount: number; docsCount: number; diaryCount: number; notesCount: number }>;
  updateUserProfile: (currentPin: string, newUsername?: string, newPin?: string) => Promise<{ success: boolean; message: string }>;
  refreshLockoutState: () => Promise<LockoutState>;
  clearError: () => void;
}

export const useLockerStore = create<LockerState>((set, get) => {
  /** Older keys the open vault's legacy rows may be under, until migration is done. */
  let legacy: LegacyKeys = { keys: [], tabPins: {} };
  /** False until the open vault is known to hold nothing in the old format. */
  let migrationDone = false;

  /** Keeps an old key for good; a failed save is retried by the next migration pass. */
  const rememberLegacy = (userId: string, add: Partial<LegacyKeys>) => {
    legacy = {
      keys: Array.from(new Set([...legacy.keys, ...(add.keys || [])])),
      tabPins: { ...legacy.tabPins, ...(add.tabPins || {}) },
    };
    VaultCrypto.setLegacyKeys(legacy.keys);
    VaultMigration.saveLegacyKeys(userId, legacy).catch(() => {});
  };

  /**
   * Opens the vault key for `user`. The first time after the update there is
   * no key yet: one is created, and the old PIN hash - which is what the
   * existing data is encrypted with - is kept as a legacy key, sealed under it.
   * False means this device has no key for a vault already in the new format.
   */
  const openVault = async (user: User): Promise<boolean> => {
    if (VaultCrypto.isOpen() && VaultCrypto.openUserId() === user.uuid) return true;
    if (await VaultCrypto.open(user.uuid)) {
      migrationDone = await VaultMigration.isComplete(user.uuid);
      try {
        legacy = await VaultMigration.loadLegacyKeys(user.uuid);
      } catch {
        // Unreadable: nothing is saved over it, and the PIN typed at login
        // re-derives the main old key anyway
        legacy = { keys: [], tabPins: {} };
      }
      // Covers an interrupted first run, where the key was stored but the
      // legacy keys were not: the account hash is then still the old one
      if (VaultCrypto.isLegacyHash(user.pinHash) && !legacy.keys.includes(user.pinHash)) {
        legacy.keys.push(user.pinHash);
        await VaultMigration.saveLegacyKeys(user.uuid, legacy);
      }
      VaultCrypto.setLegacyKeys(legacy.keys);
      return true;
    }
    if (VaultCrypto.isLegacyHash(user.pinHash)) {
      await VaultCrypto.create(user.uuid, [user.pinHash]);
      migrationDone = false;
      legacy = { keys: [user.pinHash], tabPins: {} };
      await VaultMigration.saveLegacyKeys(user.uuid, legacy);
      return true;
    }
    return false;
  };

  const missingKeyMessage =
    'This device no longer has the key for this vault, so it cannot be opened. Restore it from an OfflineLocker backup, or register a new vault.';

  /** Background pass over old-format data; the store reloads what it rewrote. */
  const startMigration = (userId: string) => {
    setTimeout(async () => {
      try {
        const complete = await VaultMigration.run(userId);
        if (!VaultCrypto.isOpen() || VaultCrypto.openUserId() !== userId) return;
        migrationDone = complete;
        if (complete) legacy = { keys: [], tabPins: {} };
        else legacy = await VaultMigration.loadLegacyKeys(userId).catch(() => legacy);
        // PIN hashes may have been upgraded; refresh them without touching plaintext
        const user = (await DatabaseHelper.getAllUsers()).find(u => u.uuid === userId);
        if (user && get().currentUser?.uuid === userId) set({ currentUser: user });
        await get().loadTabs();
        if (get().notes.length > 0) await get().loadNotes();
        await get().loadDiaryPinMode();
      } catch (error) {
        console.warn('Vault migration paused', error);
      }
    }, 1500);
  };

  /** Shared by the PIN and the biometric paths once the user is known to be the owner. */
  const completeLogin = async () => {
    await LockoutService.resetLockoutState();
    const cleanLockout = await LockoutService.getLockoutState();
    set({ isAuthenticated: true, activeDocuments: [], lockoutState: cleanLockout, errorMessage: null });
    await get().loadTabs();
    // Read here as well as on the diary's own mount: by the time the tab can
    // be tapped the answer is already in, so it never opens and then locks
    await get().loadDiaryPinMode();
    const userId = get().currentUser?.uuid;
    if (userId) startMigration(userId);
  };

  /** Replaces a legacy PIN hash once the PIN behind it has been typed correctly. */
  const upgradePinHash = (stored: string | null | undefined, pin: string, scope: 'tab' | 'note' | 'diary', write: (hash: string) => Promise<void>) => {
    if (!VaultCrypto.isLegacyHash(stored) || !VaultCrypto.isOpen()) return;
    const hash = VaultCrypto.makeVerifier(pin, scope);
    write(hash).catch(() => { /* retried by the migration */ });
  };

  return {
  currentUser: null,
  tabs: [],
  tabDocCounts: {},
  activeDocuments: [],
  isLoading: false,
  errorMessage: null,
  isAuthenticated: false,
  lockoutState: null,
  diaryDates: [],
  notes: [],
  defaultHomeTab: 'files',
  diaryLined: true,
  accentKey: DEFAULT_ACCENT_KEY,
  customAccent: DEFAULT_CUSTOM_ACCENT,
  backgroundKey: DEFAULT_BACKGROUND_KEY,
  customBackground: DEFAULT_CUSTOM_BACKGROUND,
  barKey: DEFAULT_BAR_KEY,
  customBar: DEFAULT_CUSTOM_BAR,
  diaryPageColor: DEFAULT_PAGE_COLOR_KEY,
  customDiaryPageColor: DEFAULT_CUSTOM_PAPER,
  notePageColor: DEFAULT_PAGE_COLOR_KEY,
  customNotePageColor: DEFAULT_CUSTOM_PAPER,
  themeVersion: 0,
  diaryPinMode: 'none',
  diaryPinHash: null,
  diaryPinLoaded: false,

  checkExistingUsers: async () => {
    try {
      const users = await DatabaseHelper.getAllUsers();
      const lockoutState = await LockoutService.getLockoutState();
      // A slow first read (the web opens the database in a worker) can land
      // after the user has already registered or unlocked; applying it then
      // would throw them back to the lock screen
      if (get().isAuthenticated) return;
      if (users.length > 0) {
        set({ currentUser: users[0], isAuthenticated: false, lockoutState });
      } else {
        set({ lockoutState });
      }
    } catch (error) {
      console.error('Error checking existing user', error);
    }
  },

  registerUser: async (username: string, pin: string, biometric?: boolean) => {
    try {
      if (!isNewPin(pin)) {
        set({ errorMessage: `The PIN must be exactly ${NEW_PIN_LENGTH} digits.` });
        return false;
      }
      // The old account's data is about to go, and its key and biometric switches with it
      const previous = get().currentUser?.uuid;
      await BiometricService.clearAll(previous);
      await VaultCrypto.destroy(previous);
      await DatabaseHelper.clearAllData();
      await LockoutService.resetLockoutState();

      const uuid = uuidv4();
      await VaultCrypto.create(uuid);
      legacy = { keys: [], tabPins: {} };
      const newUser: User = {
        uuid,
        username: username.trim(),
        pinHash: VaultCrypto.makeVerifier(pin, 'app'),
        createdAt: new Date().toISOString(),
      };
      await DatabaseHelper.createUser(newUser);
      // A new vault has nothing in the old format to migrate
      await VaultMigration.markComplete(uuid);
      migrationDone = true;

      const defaultTab: Tab = {
        uuid: uuidv4(),
        userId: newUser.uuid,
        name: await VaultCrypto.encrypt('General Vault'),
        description: await VaultCrypto.encrypt('Default secure storage tab'),
        isSensitive: 0,
        tabPinHash: null,
        createdAt: new Date().toISOString(),
      };
      await DatabaseHelper.createTab(defaultTab);
      if (biometric) await BiometricService.enable(newUser.uuid, BiometricScopes.app);

      const lockoutState = await LockoutService.getLockoutState();
      set({ currentUser: newUser, isAuthenticated: true, lockoutState, errorMessage: null });
      await get().loadTabs();
      return true;
    } catch (error) {
      console.error('Registration failed', error);
      // Shown on the form: returning quietly left the button looking dead
      const storageMissing = typeof window !== 'undefined' && typeof document !== 'undefined'
        && typeof SharedArrayBuffer === 'undefined';
      set({
        errorMessage: storageMissing
          ? 'This browser cannot open the vault storage here. Open the app via http://localhost:8081 (or https) instead of a network address.'
          : 'Could not create the vault. Please try again.',
      });
      return false;
    }
  },

  loginUser: async (pin: string) => {
    const { currentUser } = get();
    if (!currentUser) return false;

    const currentLockout = await LockoutService.getLockoutState();
    if (currentLockout.remainingSeconds > 0) {
      set({ lockoutState: currentLockout, errorMessage: `Vault locked. Please try again in ${currentLockout.remainingSeconds}s.` });
      return false;
    }

    // A new-format hash is keyed from the vault key, so the key is needed to
    // check it. An old hash can be checked on its own.
    const legacyAccount = VaultCrypto.isLegacyHash(currentUser.pinHash);
    if (!legacyAccount && !(await openVault(currentUser))) {
      set({ errorMessage: missingKeyMessage });
      return false;
    }

    const isValid = VaultCrypto.checkPin(pin, currentUser.pinHash, 'app');
    if (isValid) {
      if (!(await openVault(currentUser))) {
        set({ errorMessage: missingKeyMessage });
        return false;
      }
      // Older rows are encrypted with a hash of this very PIN, so while any
      // remain it is kept as a key - even if the saved copy were ever lost
      if (!migrationDone) rememberLegacy(currentUser.uuid, { keys: [VaultCrypto.legacyKeyForPin(pin)] });
      if (legacyAccount) {
        // The PIN is known right now, so the old hash is replaced at once
        const pinHash = VaultCrypto.makeVerifier(pin, 'app');
        await DatabaseHelper.setUserPinHash(currentUser.uuid, pinHash);
        set({ currentUser: { ...currentUser, pinHash } });
      }
      await completeLogin();
      return true;
    }
    VaultCrypto.close();

    // Failed attempt
    const { state, isWiped } = await LockoutService.recordFailedAttempt();
    if (isWiped) {
      await BiometricService.clearAll(currentUser.uuid);
      await VaultCrypto.destroy(currentUser.uuid);
      set({
        currentUser: null,
        tabs: [],
        tabDocCounts: {},
        activeDocuments: [],
        isAuthenticated: false,
        lockoutState: state,
        errorMessage: '⚠️ App reset: Vault data was permanently wiped due to 6 consecutive failed PIN attempts.',
      });
      return false;
    }

    let msg = `Incorrect PIN. Attempt ${state.failedAttempts}/6.`;
    if (state.failedAttempts === 3) {
      msg = `🔒 3 failed attempts. Vault is locked for 30 seconds.`;
    } else if (state.failedAttempts === 5) {
      msg = `⚠️ 5 failed attempts! Vault is locked for 5 minutes. WARNING: 6th failed attempt will wipe all data!`;
    }

    set({ lockoutState: state, errorMessage: msg });
    return false;
  },

  unlockWithBiometric: async () => {
    const { currentUser } = get();
    if (!currentUser) return false;
    // A lockout earned with wrong PINs is not lifted by switching to a scan
    const currentLockout = await LockoutService.getLockoutState();
    if (currentLockout.remainingSeconds > 0) {
      set({ lockoutState: currentLockout });
      return false;
    }
    const secret = await BiometricService.unlock(currentUser.uuid, BiometricScopes.app, 'Unlock OfflineLocker');
    if (!secret) return false;
    if (!(await openVault(currentUser))) {
      set({ errorMessage: missingKeyMessage });
      return false;
    }
    await completeLogin();
    return true;
  },

  refreshLockoutState: async () => {
    const lockoutState = await LockoutService.getLockoutState();
    set({ lockoutState });
    return lockoutState;
  },

  logout: () => {
    // Decrypted content must not survive a lock: the plaintext held in memory,
    // the files written out for the viewer and the share sheet, and the key
    clearDecryptedCache();
    VaultCrypto.close();
    legacy = { keys: [], tabPins: {} };
    migrationDone = false;
    set({ isAuthenticated: false, tabs: [], activeDocuments: [], diaryDates: [], notes: [], diaryPinMode: 'none', diaryPinHash: null, diaryPinLoaded: false });
  },

  loadTabs: async () => {
    const { currentUser } = get();
    if (!currentUser || !VaultCrypto.isOpen()) return;
    try {
      const rows = await DatabaseHelper.getTabs(currentUser.uuid);
      // Names and descriptions are stored encrypted; the list holds the plaintext
      const tabs = await Promise.all(rows.map(async tab => ({
        ...tab,
        name: await VaultCrypto.decryptLabel(tab.name),
        description: await VaultCrypto.decryptLabel(tab.description),
      })));
      const tabDocCounts = await DatabaseHelper.getTabDocumentCounts();
      set({ tabs, tabDocCounts });
    } catch (error) {
      console.error('Error loading tabs', error);
    }
  },

  createTab: async (name: string, description: string, isSensitive: boolean, tabPin?: string, biometric?: boolean) => {
    const { currentUser, tabs } = get();
    if (!currentUser) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    if (tabs.some(t => t.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      set({ errorMessage: `A tab named "${trimmed}" already exists.` });
      return false;
    }

    if (isSensitive && !isNewPin(tabPin)) {
      set({ errorMessage: `Sensitive tabs require a mandatory ${NEW_PIN_LENGTH}-digit PIN.` });
      return false;
    }

    try {
      const pinHash = isSensitive && tabPin ? VaultCrypto.makeVerifier(tabPin, 'tab') : null;
      const newTab: Tab = {
        uuid: uuidv4(),
        userId: currentUser.uuid,
        name: await VaultCrypto.encrypt(trimmed),
        description: await VaultCrypto.encrypt(description.trim() ? description.trim() : 'Custom Vault Tab'),
        isSensitive: isSensitive ? 1 : 0,
        tabPinHash: pinHash,
        createdAt: new Date().toISOString(),
      };

      await DatabaseHelper.createTab(newTab);
      if (isSensitive && tabPin && biometric) {
        await BiometricService.enable(currentUser.uuid, BiometricScopes.tab(newTab.uuid), tabPin.trim());
      }
      await get().loadTabs();
      return true;
    } catch (error) {
      console.error('Error creating tab', error);
      return false;
    }
  },

  deleteTab: async (tabId: string) => {
    await DatabaseHelper.deleteTab(tabId);
    await BiometricService.disable(get().currentUser?.uuid, BiometricScopes.tab(tabId));
    await get().loadTabs();
  },

  updateTab: async (tabId: string, name: string, description: string, isSensitive: boolean, tabPin?: string, biometric?: { enabled: boolean; pin?: string }) => {
    const trimmed = name.trim();
    if (!trimmed) return false;

    if (get().tabs.some(t => t.uuid !== tabId && t.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      set({ errorMessage: `A tab named "${trimmed}" already exists.` });
      return false;
    }

    try {
      const currentTab = get().tabs.find(tab => tab.uuid === tabId);
      if (isSensitive && tabPin?.trim() && !isNewPin(tabPin)) {
        set({ errorMessage: `Sensitive tabs require a ${NEW_PIN_LENGTH}-digit PIN.` });
        return false;
      }
      if (isSensitive && !isNewPin(tabPin) && !currentTab?.tabPinHash) {
        set({ errorMessage: `Sensitive tabs require a mandatory ${NEW_PIN_LENGTH}-digit PIN.` });
        return false;
      }
      const tabPinHash = isSensitive
        ? (tabPin?.trim() ? VaultCrypto.makeVerifier(tabPin, 'tab') : currentTab?.tabPinHash || null)
        : null;
      await DatabaseHelper.updateTab(
        tabId,
        await VaultCrypto.encrypt(name.trim()),
        await VaultCrypto.encrypt(description.trim() ? description.trim() : 'Custom Vault Tab'),
        isSensitive ? 1 : 0,
        tabPinHash
      );
      const userId = get().currentUser?.uuid;
      const scope = BiometricScopes.tab(tabId);
      const pinNow = tabPin?.trim() || biometric?.pin?.trim();
      if (!isSensitive) {
        await BiometricService.disable(userId, scope);
      } else if (biometric) {
        if (biometric.enabled && userId && pinNow) await BiometricService.enable(userId, scope, pinNow);
        else await BiometricService.disable(userId, scope);
      } else if (tabPin?.trim() && userId && await BiometricService.isEnabled(userId, scope)) {
        // A changed PIN has to replace the one a scan hands back
        await BiometricService.enable(userId, scope, tabPin.trim());
      }
      await get().loadTabs();
      return true;
    } catch (error) {
      console.error('Error updating tab', error);
      return false;
    }
  },

  verifyTabPin: (tab: Tab, candidatePin: string) => {
    if (!tab.tabPinHash) return true;
    const ok = VaultCrypto.checkPin(candidatePin, tab.tabPinHash, 'tab');
    const pin = candidatePin.trim();
    const userId = get().currentUser?.uuid;
    // Older documents in this tab may be under this PIN, so it is kept for them
    if (ok && userId && !migrationDone && legacy.tabPins[tab.uuid] !== pin) {
      rememberLegacy(userId, { tabPins: { [tab.uuid]: pin } });
    }
    if (ok && VaultCrypto.isLegacyHash(tab.tabPinHash)) {
      upgradePinHash(tab.tabPinHash, pin, 'tab', async hash => {
        await DatabaseHelper.setTabPinHash(tab.uuid, hash);
        set({ tabs: get().tabs.map(t => (t.uuid === tab.uuid ? { ...t, tabPinHash: hash } : t)) });
      });
    }
    return ok;
  },

  loadDocumentsForTab: async (tabId: string) => {
    try {
      const rows = await DatabaseHelper.getDocumentsByTab(tabId);
      // Titles and summaries are small, so they are decrypted for the whole
      // list; payloads wait until something opens a document
      const activeDocuments = await Promise.all(rows.map(async doc => {
        let plainMeta: string | null = null;
        if (doc.encryptedMeta) {
          const meta = await VaultCrypto.decrypt(doc.encryptedMeta, [legacy.tabPins[tabId]]);
          plainMeta = meta && !meta.startsWith('⚠️') ? meta : null;
        }
        return { ...doc, title: await VaultCrypto.decryptLabel(doc.title), plainMeta };
      }));
      const tabDocCounts = await DatabaseHelper.getTabDocumentCounts();
      set({ activeDocuments, tabDocCounts });
    } catch (error) {
      console.error('Error loading documents', error);
    }
  },

  addDocument: async (tabId: string, title: string, type: string, plainContent: string, plainMeta?: string) => {
    try {
      const newDoc: Document = {
        tabId,
        title: await VaultCrypto.encrypt(title.trim()),
        type,
        encryptedContent: await VaultCrypto.encrypt(plainContent),
        encryptedMeta: plainMeta ? await VaultCrypto.encrypt(plainMeta) : null,
        createdAt: new Date().toISOString(),
      };
      await DatabaseHelper.createDocument(newDoc);
      await get().loadDocumentsForTab(tabId);
    } catch (error) {
      // Swallowing this closed the window as though the document had been
      // saved, and it simply was not there afterwards. The screen reports it.
      console.error('Error adding document', error);
      throw error;
    }
  },

  deleteDocument: async (id: number, tabId: string) => {
    await DatabaseHelper.deleteDocument(id);
    await get().loadDocumentsForTab(tabId);
  },

  getDocumentContent: async (id: number) => {
    try {
      return await DatabaseHelper.getDocumentContent(id);
    } catch (error) {
      console.error('Error reading document content', error);
      return '';
    }
  },

  decryptValue: async (cipher: string, extraKeys: (string | null | undefined)[] = []) => {
    if (!VaultCrypto.isOpen()) return '';
    return VaultCrypto.decrypt(cipher, extraKeys);
  },

  upgradeDocumentContent: async (id: number, plainContent: string) => {
    try {
      if (!plainContent || plainContent.startsWith('⚠️') || !VaultCrypto.isOpen()) return;
      await DatabaseHelper.setDocumentContent(id, await VaultCrypto.encrypt(plainContent));
    } catch (error) {
      // Left in the old format; it still opens, and the next pass retries it
    }
  },

  legacyTabPin: (tabId: string) => legacy.tabPins[tabId],

  /** Backfills the list summary for a document that predates it. */
  setDocumentMeta: async (id: number, plainMeta: string) => {
    try {
      await DatabaseHelper.setDocumentMeta(id, await VaultCrypto.encrypt(plainMeta));
    } catch (error) {
      // A summary that cannot be stored is recomputed next time; nothing breaks
    }
  },

  updateDocument: async (id: number, tabId: string, title: string, plainContent: string, plainMeta?: string) => {
    try {
      const encrypted = await VaultCrypto.encrypt(plainContent);
      const meta = plainMeta ? await VaultCrypto.encrypt(plainMeta) : null;
      await DatabaseHelper.updateDocument(id, await VaultCrypto.encrypt(title.trim()), encrypted, meta);
      await get().loadDocumentsForTab(tabId);
    } catch (error) {
      console.error('Error updating document', error);
      throw error;
    }
  },

  // --- DIARY ---
  loadDiaryDates: async () => {
    const { currentUser } = get();
    if (!currentUser) return;
    try {
      set({ diaryDates: await DatabaseHelper.getDiaryDates(currentUser.uuid) });
    } catch (error) {
      set({ errorMessage: 'Could not load diary dates.' });
    }
  },

  getDiaryEntry: async (entryDate: string) => {
    const { currentUser } = get();
    if (!currentUser) return '';
    try {
      const row = await DatabaseHelper.getDiaryEntry(currentUser.uuid, entryDate);
      if (!row) return '';
      const text = await VaultCrypto.decrypt(row.encryptedContent);
      if (text.startsWith('⚠️ Decryption Failed')) throw new Error('DIARY_UNREADABLE');
      return text;
    } catch (error) {
      // Thrown rather than returned as '': an empty page is saved as a deletion,
      // so the caller must know this page did not load
      throw error instanceof Error ? error : new Error('DIARY_UNREADABLE');
    }
  },

  saveDiaryEntry: async (entryDate: string, plainContent: string) => {
    const { currentUser, diaryDates } = get();
    if (!currentUser) return;
    const now = new Date().toISOString();
    try {
      // An emptied page is removed rather than stored blank, so the day stops
      // being marked as written in the navigator
      if (!plainContent.trim()) {
        await DatabaseHelper.deleteDiaryEntry(currentUser.uuid, entryDate);
        set({ diaryDates: diaryDates.filter(d => d !== entryDate) });
        return;
      }
      await DatabaseHelper.upsertDiaryEntry({
        userId: currentUser.uuid,
        entryDate,
        encryptedContent: await VaultCrypto.encrypt(plainContent),
        createdAt: now,
        updatedAt: now,
      });
      if (!diaryDates.includes(entryDate)) {
        set({ diaryDates: [...diaryDates, entryDate].sort().reverse() });
      }
    } catch (error) {
      set({ errorMessage: 'Could not save the diary page.' });
    }
  },

  // --- NOTES ---
  loadNotes: async () => {
    const { currentUser } = get();
    if (!currentUser || !VaultCrypto.isOpen()) return;
    try {
      const rows = await DatabaseHelper.getNotes(currentUser.uuid);
      // Search and previews read the text, so it is decrypted as the list loads
      const notes = await Promise.all(rows.map(async note => {
        const content = await VaultCrypto.decrypt(note.encryptedContent);
        const unreadable = content.startsWith('⚠️ Decryption Failed');
        return {
          ...note,
          title: await VaultCrypto.decryptLabel(note.title),
          content: unreadable ? '' : content,
          unreadable,
        };
      }));
      set({ notes });
    } catch (error) {
      set({ errorMessage: 'Could not load notes.' });
    }
  },

  addNote: async (title: string, plainContent: string, isSensitive: boolean, notePin?: string, biometric?: boolean) => {
    const { currentUser, loadNotes } = get();
    if (!currentUser) return null;
    const now = new Date().toISOString();
    let id: number;
    try {
      id = await DatabaseHelper.createNote({
        userId: currentUser.uuid,
        title: await VaultCrypto.encrypt(title),
        encryptedContent: await VaultCrypto.encrypt(plainContent),
        isSensitive: isSensitive ? 1 : 0,
        // The PIN gates access; the content stays encrypted under the vault key
        notePinHash: isSensitive && notePin ? VaultCrypto.makeVerifier(notePin, 'note') : null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      set({ errorMessage: 'Could not save the note.' });
      return null;
    }
    if (isSensitive && biometric) await BiometricService.enable(currentUser.uuid, BiometricScopes.note(id));
    await loadNotes();
    return id;
  },

  updateNote: async (id: number, title: string, plainContent: string, isSensitive: boolean, notePin?: string, biometric?: boolean) => {
    const { currentUser, loadNotes, notes } = get();
    if (!currentUser) return;
    const existing = notes.find(n => n.id === id);
    // An unchanged PIN is left alone rather than cleared
    const pinHash = !isSensitive
      ? null
      : notePin && notePin.trim()
        ? VaultCrypto.makeVerifier(notePin, 'note')
        : existing?.notePinHash || null;
    // The list is ordered by this, so only a change to the text itself moves a
    // note up. Renaming it, changing its PIN or just opening and closing it
    // leaves it where it was.
    // An unreadable note keeps its stored text whatever is passed, so it never counts.
    const updatedAt = existing && (existing.unreadable || (existing.content ?? '') === plainContent)
      ? existing.updatedAt
      : new Date().toISOString();

    try {
      await DatabaseHelper.updateNote(
        id,
        await VaultCrypto.encrypt(title),
        // A note whose text could not be decrypted keeps what is stored, rather
        // than having the empty stand-in written over it
        existing?.unreadable ? existing.encryptedContent : await VaultCrypto.encrypt(plainContent),
        isSensitive ? 1 : 0,
        pinHash,
        updatedAt
      );
    } catch (error) {
      set({ errorMessage: 'Could not save the note.' });
      return;
    }
    if (!isSensitive || biometric === false) {
      await BiometricService.disable(currentUser.uuid, BiometricScopes.note(id));
    } else if (biometric) {
      await BiometricService.enable(currentUser.uuid, BiometricScopes.note(id));
    }
    await loadNotes();
  },

  setNoteColors: async (id, colors) => {
    const existing = get().notes.find(n => n.id === id);
    const pageColor = colors.pageColor !== undefined ? colors.pageColor : existing?.pageColor ?? null;
    const tabColor = colors.tabColor !== undefined ? colors.tabColor : existing?.tabColor ?? null;
    // Shown at once; the list does not wait on the write
    set({ notes: get().notes.map(n => (n.id === id ? { ...n, pageColor, tabColor } : n)) });
    try {
      await DatabaseHelper.setNoteColors(id, pageColor, tabColor);
    } catch (e) {
      set({ errorMessage: 'Could not save the note colour.' });
    }
  },

  deleteNote: async (id: number) => {
    const { loadNotes } = get();
    await DatabaseHelper.deleteNote(id);
    await BiometricService.disable(get().currentUser?.uuid, BiometricScopes.note(id));
    await loadNotes();
  },

  /** The note's text, decrypted when the list loaded. */
  decryptNote: (note: Note) => note.content ?? '',

  verifyNotePin: (note: Note, candidatePin: string) => {
    if (!note.isSensitive || !note.notePinHash) return true;
    const ok = VaultCrypto.checkPin(candidatePin, note.notePinHash, 'note');
    if (ok && note.id != null) {
      const id = note.id;
      upgradePinHash(note.notePinHash, candidatePin.trim(), 'note', async hash => {
        await DatabaseHelper.setNotePinHash(id, hash);
        set({ notes: get().notes.map(n => (n.id === id ? { ...n, notePinHash: hash } : n)) });
      });
    }
    return ok;
  },

  // --- PREFERENCES ---
  loadDefaultHomeTab: async () => {
    const { currentUser } = get();
    if (!currentUser) return;
    try {
      const stored = (await DatabaseHelper.getSetting(currentUser.uuid, 'default_home_tab')) as HomeTab | null;
      if (stored === 'files' || stored === 'diary' || stored === 'notes') set({ defaultHomeTab: stored });
    } catch (error) {
      // A missing preference simply leaves the default alone
    }
  },

  setDefaultHomeTab: async (tab: HomeTab) => {
    const { currentUser } = get();
    set({ defaultHomeTab: tab });
    if (!currentUser) return;
    await DatabaseHelper.setSetting(currentUser.uuid, 'default_home_tab', tab);
  },

  loadDiaryLined: async () => {
    const { currentUser } = get();
    if (!currentUser) return;
    try {
      const stored = await DatabaseHelper.getSetting(currentUser.uuid, 'diary_lined');
      // Absent means never set, and lined paper is the default
      if (stored !== null) set({ diaryLined: stored === '1' });
    } catch (error) {
      // Leave the default in place
    }
  },

  setDiaryLined: async (lined: boolean) => {
    const { currentUser } = get();
    set({ diaryLined: lined });
    if (!currentUser) return;
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_lined', lined ? '1' : '0');
  },

  // --- APPEARANCE ---
  /**
   * Read before the first screen paints, so the app never shows the wrong
   * accent for a frame and then correct itself.
   */
  loadAccent: async () => {
    try {
      const [accent, accentCustom, background, backgroundCustom, bar, barCustom] = await Promise.all([
        StorageService.getItem(ACCENT_STORAGE_KEY),
        StorageService.getItem(ACCENT_CUSTOM_STORAGE_KEY),
        StorageService.getItem(BACKGROUND_STORAGE_KEY),
        StorageService.getItem(BACKGROUND_CUSTOM_STORAGE_KEY),
        StorageService.getItem(BAR_STORAGE_KEY),
        StorageService.getItem(BAR_CUSTOM_STORAGE_KEY),
      ]);
      const accentKey = accent || DEFAULT_ACCENT_KEY;
      const customAccent = accentCustom || DEFAULT_CUSTOM_ACCENT;
      const backgroundKey = background || DEFAULT_BACKGROUND_KEY;
      const customBackground = backgroundCustom || DEFAULT_CUSTOM_BACKGROUND;
      const barKey = bar || DEFAULT_BAR_KEY;
      const customBar = barCustom || DEFAULT_CUSTOM_BAR;
      applyAccent(accentKey, customAccent);
      applyBackground(backgroundKey, customBackground);
      applyBars(barKey, customBar);
      set(state => ({
        accentKey,
        customAccent,
        backgroundKey,
        customBackground,
        barKey,
        customBar,
        themeVersion: state.themeVersion + 1,
      }));
    } catch (error) {
      applyAccent(DEFAULT_ACCENT_KEY);
      applyBackground(DEFAULT_BACKGROUND_KEY);
      applyBars(DEFAULT_BAR_KEY);
    }
  },

  setAccent: async (key: string) => {
    const { customAccent } = get();
    applyAccent(key, customAccent);
    set(state => ({ accentKey: key, themeVersion: state.themeVersion + 1 }));
    await StorageService.setItem(ACCENT_STORAGE_KEY, key);
  },

  /** Mixing a colour also selects it, which is what makes the swatch feel live. */
  setCustomAccent: async (hex: string) => {
    applyAccent(CUSTOM_KEY, hex);
    set(state => ({ accentKey: CUSTOM_KEY, customAccent: hex, themeVersion: state.themeVersion + 1 }));
    await StorageService.setItem(ACCENT_CUSTOM_STORAGE_KEY, hex);
    await StorageService.setItem(ACCENT_STORAGE_KEY, CUSTOM_KEY);
  },

  setBackground: async (key: string) => {
    const { customBackground } = get();
    applyBackground(key, customBackground);
    set(state => ({ backgroundKey: key, themeVersion: state.themeVersion + 1 }));
    await StorageService.setItem(BACKGROUND_STORAGE_KEY, key);
  },

  setCustomBackground: async (hex: string) => {
    applyBackground(CUSTOM_KEY, hex);
    set(state => ({ backgroundKey: CUSTOM_KEY, customBackground: hex, themeVersion: state.themeVersion + 1 }));
    await StorageService.setItem(BACKGROUND_CUSTOM_STORAGE_KEY, hex);
    await StorageService.setItem(BACKGROUND_STORAGE_KEY, CUSTOM_KEY);
  },

  setBar: async (key: string) => {
    const { customBar } = get();
    applyBars(key, customBar);
    set(state => ({ barKey: key, themeVersion: state.themeVersion + 1 }));
    await StorageService.setItem(BAR_STORAGE_KEY, key);
  },

  setCustomBar: async (hex: string) => {
    applyBars(CUSTOM_KEY, hex);
    set(state => ({ barKey: CUSTOM_KEY, customBar: hex, themeVersion: state.themeVersion + 1 }));
    await StorageService.setItem(BAR_CUSTOM_STORAGE_KEY, hex);
    await StorageService.setItem(BAR_STORAGE_KEY, CUSTOM_KEY);
  },

  loadPageColors: async () => {
    const { currentUser } = get();
    if (!currentUser) return;
    try {
      const diary = await DatabaseHelper.getSetting(currentUser.uuid, 'diary_page_color');
      const diaryCustom = await DatabaseHelper.getSetting(currentUser.uuid, 'diary_page_color_custom');
      const note = await DatabaseHelper.getSetting(currentUser.uuid, 'note_page_color');
      const noteCustom = await DatabaseHelper.getSetting(currentUser.uuid, 'note_page_color_custom');
      set({
        diaryPageColor: diary || DEFAULT_PAGE_COLOR_KEY,
        customDiaryPageColor: diaryCustom || DEFAULT_CUSTOM_PAPER,
        notePageColor: note || DEFAULT_PAGE_COLOR_KEY,
        customNotePageColor: noteCustom || DEFAULT_CUSTOM_PAPER,
      });
    } catch (error) {
      // Absent means never set, and the defaults are already in place
    }
  },

  setDiaryPageColor: async (key: string) => {
    const { currentUser } = get();
    set({ diaryPageColor: key });
    if (!currentUser) return;
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_page_color', key);
  },

  setCustomDiaryPageColor: async (hex: string) => {
    const { currentUser } = get();
    set({ diaryPageColor: CUSTOM_KEY, customDiaryPageColor: hex });
    if (!currentUser) return;
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_page_color_custom', hex);
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_page_color', CUSTOM_KEY);
  },

  setNotePageColor: async (key: string) => {
    const { currentUser } = get();
    set({ notePageColor: key });
    if (!currentUser) return;
    await DatabaseHelper.setSetting(currentUser.uuid, 'note_page_color', key);
  },

  setCustomNotePageColor: async (hex: string) => {
    const { currentUser } = get();
    set({ notePageColor: CUSTOM_KEY, customNotePageColor: hex });
    if (!currentUser) return;
    await DatabaseHelper.setSetting(currentUser.uuid, 'note_page_color_custom', hex);
    await DatabaseHelper.setSetting(currentUser.uuid, 'note_page_color', CUSTOM_KEY);
  },

  // --- DIARY PIN ---
  loadDiaryPinMode: async () => {
    const { currentUser } = get();
    if (!currentUser) return;
    try {
      const mode = (await DatabaseHelper.getSetting(currentUser.uuid, 'diary_pin_mode')) as DiaryPinMode | null;
      const hash = await DatabaseHelper.getSetting(currentUser.uuid, 'diary_pin_hash');
      set({ diaryPinMode: mode || 'none', diaryPinHash: hash, diaryPinLoaded: true });
    } catch (error) {
      set({ diaryPinMode: 'none', diaryPinHash: null, diaryPinLoaded: true });
    }
  },

  setDiaryPin: async (mode: DiaryPinMode, pin?: string, biometric?: boolean) => {
    const { currentUser } = get();
    if (!currentUser) return;
    // 'app' reuses the account's own unlock PIN, so no separate hash is stored
    const hash = mode === 'custom' && pin ? VaultCrypto.makeVerifier(pin, 'diary') : null;
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_pin_mode', mode === 'none' ? null : mode);
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_pin_hash', hash);
    set({ diaryPinMode: mode, diaryPinHash: hash, diaryPinLoaded: true });
    if (mode === 'none' || biometric === false) await BiometricService.disable(currentUser.uuid, BiometricScopes.diary);
    else if (biometric) await BiometricService.enable(currentUser.uuid, BiometricScopes.diary);
  },

  setDiaryBiometric: async (enabled: boolean) => {
    const { currentUser, diaryPinMode } = get();
    if (!currentUser) return;
    if (enabled && diaryPinMode !== 'none') await BiometricService.enable(currentUser.uuid, BiometricScopes.diary);
    else await BiometricService.disable(currentUser.uuid, BiometricScopes.diary);
  },

  verifyDiaryPin: (candidatePin: string) => {
    const { diaryPinMode, diaryPinHash, currentUser } = get();
    if (diaryPinMode === 'none') return true;
    if (diaryPinMode === 'app') {
      return !!currentUser && VaultCrypto.checkPin(candidatePin, currentUser.pinHash, 'app');
    }
    const ok = !!diaryPinHash && VaultCrypto.checkPin(candidatePin, diaryPinHash, 'diary');
    if (ok && currentUser) {
      const userId = currentUser.uuid;
      upgradePinHash(diaryPinHash, candidatePin.trim(), 'diary', async hash => {
        await DatabaseHelper.setSetting(userId, 'diary_pin_hash', hash);
        set({ diaryPinHash: hash });
      });
    }
    return ok;
  },

  verifyAppPin: (candidatePin: string) => {
    const { currentUser } = get();
    return !!currentUser && VaultCrypto.checkPin(candidatePin, currentUser.pinHash, 'app');
  },

  exportBackup: async (password: string) => {
    const { currentUser } = get();
    if (!currentUser || !VaultCrypto.isOpen()) return false;
    // A backup must open on a device that has none of the old keys, so every
    // row - large payloads included - is brought to the current format first
    const complete = await VaultMigration.run(currentUser.uuid, { includeLarge: true });
    legacy = complete ? { keys: [], tabPins: {} } : await VaultMigration.loadLegacyKeys(currentUser.uuid);
    const user = (await DatabaseHelper.getAllUsers()).find(u => u.uuid === currentUser.uuid) || currentUser;
    return await BackupService.exportBackup(user, password, complete ? null : legacy);
  },

  importBackup: async (encryptedContent: string, secret: string) => {
    const previousUserId = get().currentUser?.uuid;
    const result = await BackupService.importBackup(encryptedContent, secret);
    if (result.success && result.user) {
      // The key and switches belonged to the account that was just replaced
      if (previousUserId && previousUserId !== result.user.uuid) {
        await BiometricService.clearAll(previousUserId);
        await VaultCrypto.destroy(previousUserId);
      }
      migrationDone = await VaultMigration.isComplete(result.user.uuid);
      legacy = await VaultMigration.loadLegacyKeys(result.user.uuid).catch(() => ({ keys: VaultCrypto.legacyKeys(), tabPins: {} }));
      VaultCrypto.setLegacyKeys(legacy.keys);
      set({ currentUser: result.user, isAuthenticated: true, activeDocuments: [], diaryDates: [], notes: [] });
      await get().loadTabs();
      // The diary and notes were restored too, so their state has to come back
      // from the database rather than from whatever was in memory
      await get().loadNotes();
      await get().loadDiaryDates();
      await get().loadDiaryPinMode();
      await get().loadDiaryLined();
      await get().loadPageColors();
      await get().loadDefaultHomeTab();
      startMigration(result.user.uuid);
    }
    return {
      success: result.success,
      tabsCount: result.tabsCount,
      docsCount: result.docsCount,
      diaryCount: result.diaryCount,
      notesCount: result.notesCount,
    };
  },

  updateUserProfile: async (currentPin: string, newUsername?: string, newPin?: string) => {
    const { currentUser } = get();
    if (!currentUser) {
      return { success: false, message: 'No active user found.' };
    }

    if (!currentPin || !VaultCrypto.checkPin(currentPin, currentUser.pinHash, 'app')) {
      return { success: false, message: 'Current PIN is incorrect.' };
    }

    const trimmedUsername = newUsername ? newUsername.trim() : currentUser.username;
    if (!trimmedUsername) {
      return { success: false, message: 'Username cannot be empty.' };
    }

    const trimmedNewPin = newPin ? newPin.trim() : '';
    const isChangingPin = Boolean(trimmedNewPin);

    if (isChangingPin && !isNewPin(trimmedNewPin)) {
      return { success: false, message: `New PIN must be exactly ${NEW_PIN_LENGTH} digits.` };
    }

    try {
      // The PIN is only checked against the vault, never used as its key, so a
      // new one is a new verifier: nothing has to be re-encrypted
      const newPinHash = isChangingPin ? VaultCrypto.makeVerifier(trimmedNewPin, 'app') : currentUser.pinHash;
      await DatabaseHelper.updateUser(currentUser.uuid, trimmedUsername, newPinHash);

      const updatedUser: User = {
        ...currentUser,
        username: trimmedUsername,
        pinHash: newPinHash,
      };

      set({ currentUser: updatedUser });
      return {
        success: true,
        message: isChangingPin ? 'Username & PIN updated successfully.' : 'Username updated successfully.'
      };
    } catch (e: any) {
      console.error('updateUserProfile error:', e);
      return { success: false, message: e?.message || 'Failed to update user profile.' };
    }
  },

  clearError: () => {
    set({ errorMessage: null });
  }
  };
});
