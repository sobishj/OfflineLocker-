import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values'; // Needed for uuid in React Native
import { User, Tab, Document, Note, DiaryPinMode, HomeTab } from '../models';
import { DatabaseHelper } from '../services/DatabaseHelper';
import { CryptoService } from '../services/CryptoService';
import { BackupService } from '../services/BackupService';
import { clearDecryptedCache } from '../services/FileCacheService';
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
  registerUser: (username: string, pin: string) => Promise<boolean>;
  loginUser: (pin: string) => Promise<boolean>;
  logout: () => void;
  loadTabs: () => Promise<void>;
  createTab: (name: string, description: string, isSensitive: boolean, tabPin?: string) => Promise<boolean>;
  updateTab: (tabId: string, name: string, description: string, isSensitive: boolean, tabPin?: string) => Promise<boolean>;
  deleteTab: (tabId: string) => Promise<void>;
  verifyTabPin: (tab: Tab, candidatePin: string) => boolean;
  loadDocumentsForTab: (tabId: string) => Promise<void>;
  addDocument: (tabId: string, title: string, type: string, plainContent: string, encryptionPin: string, plainMeta?: string) => Promise<void>;
  updateDocument: (id: number, tabId: string, title: string, plainContent: string, encryptionPin: string, plainMeta?: string) => Promise<void>;
  deleteDocument: (id: number, tabId: string) => Promise<void>;
  getDocumentContent: (id: number) => Promise<string>;
  setDocumentMeta: (id: number, plainMeta: string, encryptionPin: string) => Promise<void>;
  loadDiaryDates: () => Promise<void>;
  getDiaryEntry: (entryDate: string) => Promise<string>;
  saveDiaryEntry: (entryDate: string, plainContent: string) => Promise<void>;
  loadNotes: () => Promise<void>;
  addNote: (title: string, plainContent: string, isSensitive: boolean, notePin?: string) => Promise<void>;
  updateNote: (id: number, title: string, plainContent: string, isSensitive: boolean, notePin?: string) => Promise<void>;
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
  setDiaryPin: (mode: DiaryPinMode, pin?: string) => Promise<void>;
  verifyDiaryPin: (candidatePin: string) => boolean;
  exportBackup: (exportPin: string) => Promise<boolean>;
  importBackup: (encryptedContent: string, importPin: string) => Promise<{ success: boolean; tabsCount: number; docsCount: number; diaryCount: number; notesCount: number }>;
  updateUserProfile: (currentPin: string, newUsername?: string, newPin?: string) => Promise<{ success: boolean; message: string }>;
  refreshLockoutState: () => Promise<LockoutState>;
  clearError: () => void;
}

export const useLockerStore = create<LockerState>((set, get) => ({
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
      if (users.length > 0) {
        set({ currentUser: users[0], isAuthenticated: false, lockoutState });
      } else {
        set({ lockoutState });
      }
    } catch (error) {
      console.error('Error checking existing user', error);
    }
  },

  registerUser: async (username: string, pin: string) => {
    try {
      await DatabaseHelper.clearAllData();
      await LockoutService.resetLockoutState();

      const newUser: User = {
        uuid: uuidv4(),
        username: username.trim(),
        pinHash: CryptoService.hashPin(pin.trim()),
        createdAt: new Date().toISOString(),
      };
      await DatabaseHelper.createUser(newUser);
      
      const defaultTab: Tab = {
        uuid: uuidv4(),
        userId: newUser.uuid,
        name: 'General Vault',
        description: 'Default secure storage tab',
        isSensitive: 0,
        tabPinHash: null,
        createdAt: new Date().toISOString(),
      };
      await DatabaseHelper.createTab(defaultTab);

      const lockoutState = await LockoutService.getLockoutState();
      set({ currentUser: newUser, isAuthenticated: true, lockoutState, errorMessage: null });
      await get().loadTabs();
      return true;
    } catch (error) {
      console.error('Registration failed', error);
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

    const isValid = CryptoService.verifyPin(pin.trim(), currentUser.pinHash);
    if (isValid) {
      await LockoutService.resetLockoutState();
      const cleanLockout = await LockoutService.getLockoutState();
      set({ isAuthenticated: true, activeDocuments: [], lockoutState: cleanLockout, errorMessage: null });
      await get().loadTabs();
      // Read here as well as on the diary's own mount: by the time the tab can
      // be tapped the answer is already in, so it never opens and then locks
      await get().loadDiaryPinMode();
      return true;
    }

    // Failed attempt
    const { state, isWiped } = await LockoutService.recordFailedAttempt();
    if (isWiped) {
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

  refreshLockoutState: async () => {
    const lockoutState = await LockoutService.getLockoutState();
    set({ lockoutState });
    return lockoutState;
  },

  logout: () => {
    // Decrypted diary and note content must not survive a lock, and neither do
    // the files written out for the viewer and the share sheet
    clearDecryptedCache();
    set({ isAuthenticated: false, activeDocuments: [], diaryDates: [], notes: [], diaryPinMode: 'none', diaryPinHash: null, diaryPinLoaded: false });
  },

  loadTabs: async () => {
    const { currentUser } = get();
    if (!currentUser) return;
    try {
      const tabs = await DatabaseHelper.getTabs(currentUser.uuid);
      const tabDocCounts = await DatabaseHelper.getTabDocumentCounts();
      set({ tabs, tabDocCounts });
    } catch (error) {
      console.error('Error loading tabs', error);
    }
  },

  createTab: async (name: string, description: string, isSensitive: boolean, tabPin?: string) => {
    const { currentUser, tabs } = get();
    if (!currentUser) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    if (tabs.some(t => t.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      set({ errorMessage: `A tab named "${trimmed}" already exists.` });
      return false;
    }

    if (isSensitive && (!tabPin || tabPin.trim().length !== 4)) {
      set({ errorMessage: 'Sensitive tabs require a mandatory 4-digit PIN.' });
      return false;
    }

    try {
      const pinHash = isSensitive && tabPin ? CryptoService.hashPin(tabPin.trim()) : null;
      const newTab: Tab = {
        uuid: uuidv4(),
        userId: currentUser.uuid,
        name: trimmed,
        description: description.trim() ? description.trim() : 'Custom Vault Tab',
        isSensitive: isSensitive ? 1 : 0,
        tabPinHash: pinHash,
        createdAt: new Date().toISOString(),
      };

      await DatabaseHelper.createTab(newTab);
      await get().loadTabs();
      return true;
    } catch (error) {
      console.error('Error creating tab', error);
      return false;
    }
  },

  deleteTab: async (tabId: string) => {
    await DatabaseHelper.deleteTab(tabId);
    await get().loadTabs();
  },

  updateTab: async (tabId: string, name: string, description: string, isSensitive: boolean, tabPin?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;

    if (get().tabs.some(t => t.uuid !== tabId && t.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      set({ errorMessage: `A tab named "${trimmed}" already exists.` });
      return false;
    }

    try {
      const currentTab = get().tabs.find(tab => tab.uuid === tabId);
      if (isSensitive && tabPin?.trim() && tabPin.trim().length !== 4) {
        set({ errorMessage: 'Sensitive tabs require a 4-digit PIN.' });
        return false;
      }
      if (isSensitive && (!tabPin || tabPin.trim().length !== 4) && !currentTab?.tabPinHash) {
        set({ errorMessage: 'Sensitive tabs require a mandatory 4-digit PIN.' });
        return false;
      }
      const tabPinHash = isSensitive
        ? (tabPin?.trim() ? CryptoService.hashPin(tabPin.trim()) : currentTab?.tabPinHash || null)
        : null;
      await DatabaseHelper.updateTab(
        tabId,
        name.trim(),
        description.trim() ? description.trim() : 'Custom Vault Tab',
        isSensitive ? 1 : 0,
        tabPinHash
      );
      await get().loadTabs();
      return true;
    } catch (error) {
      console.error('Error updating tab', error);
      return false;
    }
  },

  verifyTabPin: (tab: Tab, candidatePin: string) => {
    if (!tab.tabPinHash) return true;
    return CryptoService.verifyPin(candidatePin.trim(), tab.tabPinHash);
  },

  loadDocumentsForTab: async (tabId: string) => {
    try {
      let activeDocuments = await DatabaseHelper.getDocumentsByTab(tabId);
      
      // Empty block removed to prevent auto-generating mock data when a tab is empty
      const tabDocCounts = await DatabaseHelper.getTabDocumentCounts();
      set({ activeDocuments, tabDocCounts });
    } catch (error) {
      console.error('Error loading documents', error);
    }
  },

  addDocument: async (tabId: string, title: string, type: string, plainContent: string, encryptionPin: string, plainMeta?: string) => {
    try {
      const encrypted = CryptoService.encryptText(plainContent, encryptionPin);
      const newDoc: Document = {
        tabId,
        title: title.trim(),
        type,
        encryptedContent: encrypted,
        encryptedMeta: plainMeta ? CryptoService.encryptText(plainMeta, encryptionPin) : null,
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

  /** Backfills the list summary for a document that predates it. */
  setDocumentMeta: async (id: number, plainMeta: string, encryptionPin: string) => {
    try {
      await DatabaseHelper.setDocumentMeta(id, CryptoService.encryptText(plainMeta, encryptionPin));
    } catch (error) {
      // A summary that cannot be stored is recomputed next time; nothing breaks
    }
  },

  updateDocument: async (id: number, tabId: string, title: string, plainContent: string, encryptionPin: string, plainMeta?: string) => {
    try {
      const encrypted = CryptoService.encryptText(plainContent, encryptionPin);
      const meta = plainMeta ? CryptoService.encryptText(plainMeta, encryptionPin) : null;
      await DatabaseHelper.updateDocument(id, title.trim(), encrypted, meta);
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
      return CryptoService.decryptText(row.encryptedContent, currentUser.pinHash);
    } catch (error) {
      return '';
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
        encryptedContent: CryptoService.encryptText(plainContent, currentUser.pinHash),
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
    if (!currentUser) return;
    try {
      set({ notes: await DatabaseHelper.getNotes(currentUser.uuid) });
    } catch (error) {
      set({ errorMessage: 'Could not load notes.' });
    }
  },

  addNote: async (title: string, plainContent: string, isSensitive: boolean, notePin?: string) => {
    const { currentUser, loadNotes } = get();
    if (!currentUser) return;
    const now = new Date().toISOString();
    try {
      await DatabaseHelper.createNote({
        userId: currentUser.uuid,
        title,
        encryptedContent: CryptoService.encryptText(plainContent, currentUser.pinHash),
        isSensitive: isSensitive ? 1 : 0,
        // The PIN gates access; the content stays encrypted under the account key
        notePinHash: isSensitive && notePin ? CryptoService.hashPin(notePin.trim()) : null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      set({ errorMessage: 'Could not save the note.' });
      return;
    }
    await loadNotes();
  },

  updateNote: async (id: number, title: string, plainContent: string, isSensitive: boolean, notePin?: string) => {
    const { currentUser, loadNotes, notes } = get();
    if (!currentUser) return;
    const existing = notes.find(n => n.id === id);
    // An unchanged PIN is left alone rather than cleared
    const pinHash = !isSensitive
      ? null
      : notePin && notePin.trim()
        ? CryptoService.hashPin(notePin.trim())
        : existing?.notePinHash || null;

    try {
      await DatabaseHelper.updateNote(
        id,
        title,
        CryptoService.encryptText(plainContent, currentUser.pinHash),
        isSensitive ? 1 : 0,
        pinHash,
        new Date().toISOString()
      );
    } catch (error) {
      set({ errorMessage: 'Could not save the note.' });
      return;
    }
    await loadNotes();
  },

  deleteNote: async (id: number) => {
    const { loadNotes } = get();
    await DatabaseHelper.deleteNote(id);
    await loadNotes();
  },

  decryptNote: (note: Note) => {
    const { currentUser } = get();
    if (!currentUser) return '';
    return CryptoService.decryptText(note.encryptedContent, currentUser.pinHash);
  },

  verifyNotePin: (note: Note, candidatePin: string) => {
    if (!note.isSensitive || !note.notePinHash) return true;
    return CryptoService.verifyPin(candidatePin.trim(), note.notePinHash);
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

  setDiaryPin: async (mode: DiaryPinMode, pin?: string) => {
    const { currentUser } = get();
    if (!currentUser) return;
    // 'app' reuses the account's own unlock PIN, so no separate hash is stored
    const hash = mode === 'custom' && pin ? CryptoService.hashPin(pin.trim()) : null;
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_pin_mode', mode === 'none' ? null : mode);
    await DatabaseHelper.setSetting(currentUser.uuid, 'diary_pin_hash', hash);
    set({ diaryPinMode: mode, diaryPinHash: hash, diaryPinLoaded: true });
  },

  verifyDiaryPin: (candidatePin: string) => {
    const { diaryPinMode, diaryPinHash, currentUser } = get();
    if (diaryPinMode === 'none') return true;
    const pin = candidatePin.trim();
    if (diaryPinMode === 'app') {
      return !!currentUser && CryptoService.verifyPin(pin, currentUser.pinHash);
    }
    return !!diaryPinHash && CryptoService.verifyPin(pin, diaryPinHash);
  },

  exportBackup: async (exportPin: string) => {
    const { currentUser } = get();
    if (!currentUser) return false;
    return await BackupService.exportBackup(currentUser, exportPin);
  },

  importBackup: async (encryptedContent: string, importPin: string) => {
    const result = await BackupService.importBackup(encryptedContent, importPin);
    if (result.success && result.user) {
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

    if (!currentPin || !CryptoService.verifyPin(currentPin.trim(), currentUser.pinHash)) {
      return { success: false, message: 'Current PIN is incorrect.' };
    }

    const trimmedUsername = newUsername ? newUsername.trim() : currentUser.username;
    if (!trimmedUsername) {
      return { success: false, message: 'Username cannot be empty.' };
    }

    const trimmedNewPin = newPin ? newPin.trim() : '';
    const isChangingPin = Boolean(trimmedNewPin);

    if (isChangingPin) {
      if (trimmedNewPin.length !== 4 || !/^\d{4}$/.test(trimmedNewPin)) {
        return { success: false, message: 'New PIN must be exactly 4 digits.' };
      }
    }

    try {
      const oldPinHash = currentUser.pinHash;
      let newPinHash = oldPinHash;

      if (isChangingPin) {
        newPinHash = CryptoService.hashPin(trimmedNewPin);

        // Re-encrypt every document that was encrypted with oldPinHash. All of
        // the work happens first and nothing is written until it has all
        // succeeded: encrypting as we went meant that a failure part way
        // through left some documents under the new PIN and the rest under the
        // old one, with no way back to either.
        const allDocs = await DatabaseHelper.getAllDocuments();
        const rewrites: { id: number; title: string; content: string; meta: string | null }[] = [];

        for (const doc of allDocs) {
          if (doc.encryptedContent && doc.id) {
            const decrypted = CryptoService.decryptText(doc.encryptedContent, oldPinHash);
            if (decrypted && !decrypted.startsWith('⚠️ Decryption Failed')) {
              const reEncrypted = CryptoService.encryptText(decrypted, newPinHash);
              let reMeta: string | null = null;
              if (doc.encryptedMeta) {
                const meta = CryptoService.decryptText(doc.encryptedMeta, oldPinHash);
                if (meta && !meta.startsWith('⚠️ Decryption Failed')) {
                  reMeta = CryptoService.encryptText(meta, newPinHash);
                }
              }
              rewrites.push({ id: doc.id, title: doc.title, content: reEncrypted, meta: reMeta });
            }
          }
        }

        for (const rewrite of rewrites) {
          await DatabaseHelper.updateDocument(rewrite.id, rewrite.title, rewrite.content, rewrite.meta);
        }
      }

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
}));
