import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values'; // Needed for uuid in React Native
import { User, Tab, Document } from '../models';
import { DatabaseHelper } from '../services/DatabaseHelper';
import { CryptoService } from '../services/CryptoService';

interface WalletState {
  currentUser: User | null;
  tabs: Tab[];
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
  deleteTab: (tabId: string) => Promise<void>;
  verifyTabPin: (tab: Tab, candidatePin: string) => boolean;
  loadDocumentsForTab: (tabId: string) => Promise<void>;
  addDocument: (tabId: string, title: string, type: string, plainContent: string, encryptionPin: string) => Promise<void>;
  deleteDocument: (id: number, tabId: string) => Promise<void>;
  clearError: () => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  currentUser: null,
  tabs: [],
  activeDocuments: [],
  isLoading: false,
  errorMessage: null,
  isAuthenticated: false,

  checkExistingUsers: async () => {
    set({ isLoading: true });
    try {
      const users = await DatabaseHelper.getAllUsers();
      if (users.length > 0) {
        // Auto-select first user, prompt for login
        set({ currentUser: users[0] });
        await get().loadTabs();
      }
    } catch (error) {
      console.error(error);
    }
    set({ isLoading: false });
  },

  registerUser: async (username: string, pin: string) => {
    if (!username.trim() || pin.trim().length !== 4) {
      set({ errorMessage: 'Please provide a valid username and mandatory 4-digit PIN.' });
      return false;
    }
    set({ isLoading: true });
    try {
      const pinHash = CryptoService.hashPin(pin.trim());
      const newUser: User = {
        uuid: uuidv4(),
        username: username.trim(),
        pinHash,
        createdAt: new Date().toISOString(),
      };

      await DatabaseHelper.createUser(newUser);
      set({ currentUser: newUser, errorMessage: null });
      await get().loadTabs();
      set({ isLoading: false });
      return true;
    } catch (error) {
      set({ isLoading: false, errorMessage: 'Failed to register.' });
      return false;
    }
  },

  loginUser: async (pin: string) => {
    const { currentUser } = get();
    if (!currentUser) return false;

    const isValid = CryptoService.verifyPin(pin.trim(), currentUser.pinHash);
    if (!isValid) {
      set({ errorMessage: 'Incorrect PIN.' });
      return false;
    }
    set({ errorMessage: null, isAuthenticated: true });
    return true;
  },

  logout: () => {
    set({ currentUser: null, isAuthenticated: false, tabs: [], activeDocuments: [] });
  },

  loadTabs: async () => {
    const { currentUser } = get();
    if (!currentUser) return;
    try {
      const tabs = await DatabaseHelper.getTabs(currentUser.uuid);
      set({ tabs });
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

  verifyTabPin: (tab: Tab, candidatePin: string) => {
    if (!tab.tabPinHash) return true;
    return CryptoService.verifyPin(candidatePin.trim(), tab.tabPinHash);
  },

  loadDocumentsForTab: async (tabId: string) => {
    try {
      const activeDocuments = await DatabaseHelper.getDocumentsByTab(tabId);
      set({ activeDocuments });
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

  clearError: () => {
    set({ errorMessage: null });
  }
}));
