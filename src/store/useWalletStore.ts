import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values'; // Needed for uuid in React Native
import { User, Tab, Document } from '../models';
import { DatabaseHelper } from '../services/DatabaseHelper';
import { CryptoService } from '../services/CryptoService';
import { BackupService } from '../services/BackupService';

interface WalletState {
  currentUser: User | null;
  tabs: Tab[];
  tabDocCounts: Record<string, number>;
  activeDocuments: Document[];
  isLoading: boolean;
  errorMessage: string | null;
  isAuthenticated: boolean;

  // Actions
  checkExistingUsers: () => Promise<void>;
  registerUser: (username: string, pin: string) => Promise<boolean>;
  loginUser: (pin: string) => Promise<boolean>;
  logout: () => void;
  loadTabs: () => Promise<void>;
  createTab: (name: string, description: string, isSensitive: boolean, tabPin?: string) => Promise<boolean>;
  updateTab: (tabId: string, name: string, description: string) => Promise<boolean>;
  deleteTab: (tabId: string) => Promise<void>;
  verifyTabPin: (tab: Tab, candidatePin: string) => boolean;
  loadDocumentsForTab: (tabId: string) => Promise<void>;
  addDocument: (tabId: string, title: string, type: string, plainContent: string, encryptionPin: string) => Promise<void>;
  updateDocument: (id: number, tabId: string, title: string, plainContent: string, encryptionPin: string) => Promise<void>;
  deleteDocument: (id: number, tabId: string) => Promise<void>;
  exportBackup: (exportPin: string) => Promise<boolean>;
  importBackup: (encryptedContent: string, importPin: string) => Promise<{ success: boolean; tabsCount: number; docsCount: number }>;
  clearError: () => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  currentUser: null,
  tabs: [],
  tabDocCounts: {},
  activeDocuments: [],
  isLoading: false,
  errorMessage: null,
  isAuthenticated: false,

  checkExistingUsers: async () => {
    try {
      const users = await DatabaseHelper.getAllUsers();
      if (users.length > 0) {
        set({ currentUser: users[0], isAuthenticated: false });
      }
    } catch (error) {
      console.error('Error checking existing user', error);
    }
  },

  registerUser: async (username: string, pin: string) => {
    try {
      await DatabaseHelper.clearAllData();

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

      set({ currentUser: newUser, isAuthenticated: true });
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

    const isValid = CryptoService.verifyPin(pin.trim(), currentUser.pinHash);
    if (isValid) {
      set({ isAuthenticated: true });
      await get().loadTabs();
      return true;
    }
    return false;
  },

  logout: () => {
    set({ isAuthenticated: false, activeDocuments: [] });
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
    const { currentUser } = get();
    if (!currentUser) return false;
    if (!name.trim()) return false;

    if (isSensitive && (!tabPin || tabPin.trim().length !== 4)) {
      set({ errorMessage: 'Sensitive tabs require a mandatory 4-digit PIN.' });
      return false;
    }

    try {
      const pinHash = isSensitive && tabPin ? CryptoService.hashPin(tabPin.trim()) : null;
      const newTab: Tab = {
        uuid: uuidv4(),
        userId: currentUser.uuid,
        name: name.trim(),
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

  updateTab: async (tabId: string, name: string, description: string) => {
    if (!name.trim()) return false;
    try {
      await DatabaseHelper.updateTab(tabId, name.trim(), description.trim() ? description.trim() : 'Custom Vault Tab');
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
      const activeDocuments = await DatabaseHelper.getDocumentsByTab(tabId);
      const tabDocCounts = await DatabaseHelper.getTabDocumentCounts();
      set({ activeDocuments, tabDocCounts });
    } catch (error) {
      console.error('Error loading documents', error);
    }
  },

  addDocument: async (tabId: string, title: string, type: string, plainContent: string, encryptionPin: string) => {
    try {
      const encrypted = CryptoService.encryptText(plainContent, encryptionPin);
      const newDoc: Document = {
        tabId,
        title: title.trim(),
        type,
        encryptedContent: encrypted,
        createdAt: new Date().toISOString(),
      };
      await DatabaseHelper.createDocument(newDoc);
      await get().loadDocumentsForTab(tabId);
    } catch (error) {
      console.error('Error adding document', error);
    }
  },

  deleteDocument: async (id: number, tabId: string) => {
    await DatabaseHelper.deleteDocument(id);
    await get().loadDocumentsForTab(tabId);
  },

  updateDocument: async (id: number, tabId: string, title: string, plainContent: string, encryptionPin: string) => {
    try {
      const encrypted = CryptoService.encryptText(plainContent, encryptionPin);
      await DatabaseHelper.updateDocument(id, title.trim(), encrypted);
      await get().loadDocumentsForTab(tabId);
    } catch (error) {
      console.error('Error updating document', error);
    }
  },

  exportBackup: async (exportPin: string) => {
    const { currentUser } = get();
    if (!currentUser) return false;
    return await BackupService.exportBackup(currentUser, exportPin);
  },

  importBackup: async (encryptedContent: string, importPin: string) => {
    const result = await BackupService.importBackup(encryptedContent, importPin);
    if (result.success && result.user) {
      set({ currentUser: result.user, isAuthenticated: true });
      await get().loadTabs();
    }
    return { success: result.success, tabsCount: result.tabsCount, docsCount: result.docsCount };
  },

  clearError: () => {
    set({ errorMessage: null });
  }
}));
