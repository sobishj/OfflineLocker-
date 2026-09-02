import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import 'react-native-get-random-values'; // Needed for uuid in React Native
import { User, Tab, Document } from '../models';
import { DatabaseHelper } from '../services/DatabaseHelper';
import { CryptoService } from '../services/CryptoService';
import { BackupService } from '../services/BackupService';
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
  addDocument: (tabId: string, title: string, type: string, plainContent: string, encryptionPin: string) => Promise<void>;
  updateDocument: (id: number, tabId: string, title: string, plainContent: string, encryptionPin: string) => Promise<void>;
  deleteDocument: (id: number, tabId: string) => Promise<void>;
  exportBackup: (exportPin: string) => Promise<boolean>;
  importBackup: (encryptedContent: string, importPin: string) => Promise<{ success: boolean; tabsCount: number; docsCount: number }>;
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
      set({ isAuthenticated: true, lockoutState: cleanLockout, errorMessage: null });
      await get().loadTabs();
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

  updateTab: async (tabId: string, name: string, description: string, isSensitive: boolean, tabPin?: string) => {
    if (!name.trim()) return false;
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
      
      if (activeDocuments.length === 0) {
        const { currentUser } = get();
        const pinKey = currentUser?.pinHash || 'default_fallback';
        
        const samplePdfBase64 = 'data:application/pdf;base64,JVBERi0xLjQKJSDl4uXmAjoKMSAwIG9iaiA8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4gZW5kb2JqCjIgMCBvYmogPDwgL1R5cGUgL1BhZ2VzIC9Db3VudCAxIC9LaWRzIFsgMyAwIFIgPSA+PiBlbmRvYmoKMyAwIG9iaiA8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIFsgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNCAwIFIgPj4gPj4gL0NvbnRlbnRzIDUgMCBSID4+IGVuZG9iago0IDAgb2JqIDw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PiBlbmRvYmoKNSAwIG9iaiA8PCAvTGVuZ3RoIDQ0ID4+IHN0cmVhbQpCVCAvRjEgMjQgVGYgMTAwIDcwMCBUZCAoT2ZmbGluZUxvY2tlciBTYW1wbGUgRG9jdW1lbnQpIFRqIEVDCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAwNjggMDAwMDAgbiAKMDAwMDAwMDEzMyAwMDAwMCBuIAowMDAwMDAwMjgxIDAwMDAwIG4gCjAwMDAwMDAzNTMgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0NDcKJSVFT0Y=';
        
        const sampleImgBase64 = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="%232563eb"/><circle cx="300" cy="200" r="100" fill="%2360a5fa" opacity="0.6"/><text x="300" y="210" font-family="sans-serif" font-size="24" font-weight="bold" fill="white" text-anchor="middle">Sample Vacation Image</text></svg>';

        await DatabaseHelper.createDocument({
          tabId,
          title: 'Summer Vacation.jpg',
          type: 'image',
          encryptedContent: CryptoService.encryptText(JSON.stringify([sampleImgBase64]), pinKey),
          createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
        });

        await DatabaseHelper.createDocument({
          tabId,
          title: 'Passport Scan.pdf',
          type: 'pdf',
          encryptedContent: CryptoService.encryptText(JSON.stringify([samplePdfBase64]), pinKey),
          createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        });

        await DatabaseHelper.createDocument({
          tabId,
          title: 'Insurance Document.pdf',
          type: 'pdf',
          encryptedContent: CryptoService.encryptText(JSON.stringify([samplePdfBase64]), pinKey),
          createdAt: new Date().toISOString(),
        });

        activeDocuments = await DatabaseHelper.getDocumentsByTab(tabId);
      }

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
