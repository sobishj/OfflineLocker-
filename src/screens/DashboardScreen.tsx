import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import Modal from '../components/AppModal';
import { useLockerStore } from '../store/useLockerStore';
import {
  AppTheme, ACCENTS, BACKGROUNDS, BAR_COLORS, CUSTOM_KEY,
  DEFAULT_ACCENT_KEY, DEFAULT_BACKGROUND_KEY, DEFAULT_BAR_KEY,
  getAccent, getBackground, getBar,
} from '../theme/AppTheme';
import ModalCloseButton from '../components/ModalCloseButton';
import ColorPickerModal from '../components/ColorPickerModal';
import { HomeTab } from '../models';
import DiaryView from '../components/DiaryView';
import NotesView from '../components/NotesView';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import DraggableFAB from '../components/DraggableFAB';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StorageService } from '../utils/storage';
import { VaultCrypto } from '../services/VaultCrypto';
import { BACKUP_PASSWORD_MIN } from '../services/BackupService';
import { NEW_PIN_LENGTH } from '../store/useLockerStore';
import { withoutAutoLock } from '../services/AutoLockService';
import BiometricToggle, { BiometricUnlockButton } from '../components/BiometricToggle';
import { BiometricService, BiometricScopes } from '../services/BiometricService';

type DashboardProps = {
  navigation: NativeStackNavigationProp<any>;
};

/** The three home tabs, shared by the bottom bar and the launch preference. */
const HOME_TAB_OPTIONS: { key: HomeTab; label: string; icon: 'folder' | 'book' | 'document-text' }[] = [
  { key: 'files', label: 'Files', icon: 'folder' },
  { key: 'diary', label: 'Diary', icon: 'book' },
  { key: 'notes', label: 'Notes', icon: 'document-text' },
];

export default function DashboardScreen({ navigation }: DashboardProps) {
  const { tabs, tabDocCounts, logout, createTab, updateTab, deleteTab, verifyTabPin, verifyAppPin, exportBackup, importBackup, currentUser, updateUserProfile, accentKey, setAccent, customAccent, setCustomAccent, backgroundKey, setBackground, customBackground, setCustomBackground, barKey, setBar, customBar, setCustomBar, themeVersion } = useLockerStore();
  const styles = useMemo(() => createStyles(), [themeVersion]);
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < 768;
  const insets = useSafeAreaInsets();

  const { defaultHomeTab, loadDefaultHomeTab, setDefaultHomeTab } = useLockerStore();
  const [homeTab, setHomeTab] = useState<HomeTab>('files');
  // Only the first arrival should follow the preference; later tab taps stand
  const appliedDefaultRef = useRef(false);
  const [tabPickerOpen, setTabPickerOpen] = useState(false);
  // Settings split in two: credentials behind the current PIN, preferences not
  const [settingsMenuVisible, setSettingsMenuVisible] = useState(false);
  const [appSettingsVisible, setAppSettingsVisible] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);

  // Dismissing a window has to clear its draft the way its Cancel button does,
  // or a half-typed PIN would still be sitting there the next time it opens.
  const closeCreateTab = () => {
    setModalVisible(false);
    setTabName('');
    setTabDesc('');
    setIsSensitive(false);
    setTabPin('');
    setConfirmTabPin('');
    setTabBiometric(false);
  };
  const closeEditTab = () => {
    setEditModalVisible(false);
    setEditTabId('');
    setEditTabName('');
    setEditTabDesc('');
    setEditIsSensitive(false);
    setEditTabPin('');
    setEditConfirmTabPin('');
    setEditTabBiometric(false);
    setEditKnownPin('');
  };
  const closePinModal = () => {
    setPinModalVisible(false);
    setUnlockPin('');
  };
  const closeExportModal = () => {
    setExportModalVisible(false);
    setExportPin('');
    setExportPinConfirm('');
  };
  const closeImportModal = () => {
    // A restore in flight must not be abandoned half way through
    if (isImporting || isReadingFile) return;
    setImportModalVisible(false);
    setImportPin('');
    setPickedFileContent(null);
    setPickedFileName(null);
  };
  // Which palette the colour picker is mixing for, if it is open at all
  const [colorPickerFor, setColorPickerFor] = useState<'accent' | 'background' | 'bar' | null>(null);
  const [accountDefaultTab, setAccountDefaultTab] = useState<HomeTab>('files');

  // The preference is read from the database, so the tab can only be applied
  // once that read has come back — doing it on mount would just re-apply the
  // store's initial value and then ignore the real one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadDefaultHomeTab();
      if (cancelled || appliedDefaultRef.current) return;
      appliedDefaultRef.current = true;
      setHomeTab(useLockerStore.getState().defaultHomeTab);
    })();
    return () => { cancelled = true; };
  }, []);
  const [modalVisible, setModalVisible] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  
  // New tab state
  const [tabName, setTabName] = useState('');
  const [tabDesc, setTabDesc] = useState('');
  const [isSensitive, setIsSensitive] = useState(false);
  const [tabPin, setTabPin] = useState('');
  const [confirmTabPin, setConfirmTabPin] = useState('');
  const [tabBiometric, setTabBiometric] = useState(false);

  // Delete tab confirmation
  const [deleteConfirmTab, setDeleteConfirmTab] = useState<any>(null);

  // Edit tab state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTabId, setEditTabId] = useState('');
  const [editTabName, setEditTabName] = useState('');
  const [editTabDesc, setEditTabDesc] = useState('');
  const [editIsSensitive, setEditIsSensitive] = useState(false);
  const [editTabPin, setEditTabPin] = useState('');
  const [editConfirmTabPin, setEditConfirmTabPin] = useState('');
  const [editTabBiometric, setEditTabBiometric] = useState(false);
  // The tab's PIN as verified on the way into the editor, kept so biometrics can
  // be switched on without the PIN having to be changed
  const [editKnownPin, setEditKnownPin] = useState('');

  // Unlock tab state
  const [selectedTab, setSelectedTab] = useState<any>(null);
  const [unlockPin, setUnlockPin] = useState('');
  const [pinActionTarget, setPinActionTarget] = useState<'open' | 'edit' | 'delete'>('open');
  // Whether the tab in the PIN window can also be opened with a scan
  const [tabBiometricOn, setTabBiometricOn] = useState(false);
  // Existing PINs may still be 4 digits; the field waits for as many as the PIN has
  const unlockPinLength = VaultCrypto.pinLength(selectedTab?.tabPinHash);
  const currentPinLength = VaultCrypto.pinLength(currentUser?.pinHash);

  // Export / Import state
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportPin, setExportPin] = useState('');
  const [exportPinConfirm, setExportPinConfirm] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importPin, setImportPin] = useState('');
  const [pickedFileContent, setPickedFileContent] = useState<string | null>(null);
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const isImportingRef = useRef(false);

  // Account / Profile state
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [accountUsername, setAccountUsername] = useState('');
  const [accountCurrentPin, setAccountCurrentPin] = useState('');
  const [accountNewPin, setAccountNewPin] = useState('');
  const [accountConfirmNewPin, setAccountConfirmNewPin] = useState('');
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [showNewPin, setShowNewPin] = useState(false);
  const [isUpdatingAccount, setIsUpdatingAccount] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isEditingNewPin, setIsEditingNewPin] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBiometric, setAccountBiometric] = useState(false);
  const [accountBiometricInitial, setAccountBiometricInitial] = useState(false);
  const usernameInputRef = useRef<TextInput | null>(null);
  const newPinInputRef = useRef<TextInput | null>(null);

  // Category Sort state
  type SortOption = 'newest' | 'oldest' | 'name_asc' | 'name_desc';
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);

  useEffect(() => {
    const loadTabSortPref = async () => {
      const saved = await StorageService.getItem('@offline_locker_tab_sort_option');
      if (saved && ['newest', 'oldest', 'name_asc', 'name_desc'].includes(saved)) {
        setSortOption(saved as SortOption);
      }
    };
    loadTabSortPref();
  }, []);

  const TAB_SORT_OPTIONS: { id: SortOption; label: string; desc: string; icon: any }[] = [
    { id: 'newest', label: 'Newest First', desc: 'Recently created categories appear first', icon: 'time-outline' },
    { id: 'oldest', label: 'Oldest First', desc: 'Earliest created categories appear first', icon: 'hourglass-outline' },
    { id: 'name_asc', label: 'Name (A to Z)', desc: 'Alphabetical category order', icon: 'text-outline' },
    { id: 'name_desc', label: 'Name (Z to A)', desc: 'Reverse alphabetical category order', icon: 'text-outline' },
  ];

  const getSortLabel = (opt: SortOption) => {
    switch (opt) {
      case 'newest': return 'Newest First';
      case 'oldest': return 'Oldest First';
      case 'name_asc': return 'Name (A–Z)';
      case 'name_desc': return 'Name (Z–A)';
      default: return 'Sort';
    }
  };

  const sortedTabs = useMemo(() => {
    const list = [...tabs];
    switch (sortOption) {
      case 'newest':
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case 'oldest':
        return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case 'name_asc':
        return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
      case 'name_desc':
        return list.sort((a, b) => (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' }));
      default:
        return list;
    }
  }, [tabs, sortOption]);

  // Imperative hidden file input for Web — native DOM event, immune to React Modal layering
  const webFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.olocker';
    input.style.display = 'none';
    document.body.appendChild(input);
    webFileInputRef.current = input;

    const handleChange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Reset so same file can be selected again
      input.value = '';

      if (!file.name.toLowerCase().endsWith('.olocker')) {
        Alert.alert('Invalid File', 'Please select an OfflineLocker backup file (*.olocker).');
        return;
      }

      setIsReadingFile(true);
      try {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve((ev.target?.result as string) || '');
          reader.onerror = reject;
          reader.readAsText(file);
        });

        if (!text || !text.trim()) {
          Alert.alert('Error', 'The selected backup file appears to be empty or inaccessible.');
          return;
        }

        setPickedFileName(file.name);
        setPickedFileContent(text.trim());
      } catch (err: any) {
        console.error('Web file read error:', err);
        Alert.alert('File Read Error', 'Could not read the selected file.');
      } finally {
        setIsReadingFile(false);
      }
    };

    input.addEventListener('change', handleChange);
    return () => {
      input.removeEventListener('change', handleChange);
      document.body.removeChild(input);
      webFileInputRef.current = null;
    };
  }, []);

  const openEditTabModal = async (tab: any, knownPin = '') => {
    setEditTabId(tab.uuid);
    setEditTabName(tab.name);
    setEditTabDesc(tab.description || '');
    setEditIsSensitive(tab.isSensitive === 1);
    setEditTabPin('');
    setEditConfirmTabPin('');
    setEditKnownPin(knownPin);
    setEditTabBiometric(await BiometricService.isEnabled(currentUser?.uuid, BiometricScopes.tab(tab.uuid)));
    setEditModalVisible(true);
  };

  const handleOpenEditTab = (tab: any) => {
    if (tab.isSensitive === 1 && tab.tabPinHash) {
      requestTabPin(tab, 'edit');
      return;
    }
    openEditTabModal(tab);
  };

  const handleSaveEditTab = async () => {
    const trimmed = editTabName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please enter a tab name.');
      return;
    }
    const isDuplicate = tabs.some(
      t => t.uuid !== editTabId && t.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      Alert.alert('Duplicate Tab Name', `A tab named "${trimmed}" already exists. Please choose a different name.`);
      return;
    }

    if (editIsSensitive && (editTabPin.trim() || editConfirmTabPin.trim())) {
      if (!new RegExp(`^\\d{${NEW_PIN_LENGTH}}$`).test(editTabPin.trim())) {
        Alert.alert('Invalid PIN', `Tab PIN must be exactly ${NEW_PIN_LENGTH} digits.`);
        return;
      }
      if (!editConfirmTabPin.trim()) {
        Alert.alert('Confirm Tab PIN', `Please re-enter and confirm the new ${NEW_PIN_LENGTH}-digit Tab PIN.`);
        return;
      }
      if (editTabPin.trim() !== editConfirmTabPin.trim()) {
        Alert.alert('PIN Mismatch', 'New Tab PIN and Confirm Tab PIN do not match.');
        return;
      }
    }

    const success = await updateTab(
      editTabId, editTabName, editTabDesc, editIsSensitive, editTabPin,
      editIsSensitive ? { enabled: editTabBiometric, pin: editTabPin.trim() || editKnownPin } : undefined
    );
    if (success) {
      closeEditTab();
    } else {
      Alert.alert('Error', 'Failed to update tab details.');
    }
  };

  const showDeleteTabPrompt = (tab: any) => {
    if (Platform.OS === 'web') {
      setDeleteConfirmTab(tab);
    } else {
      Alert.alert(
        'Delete Vault Tab',
        `Are you sure you want to delete "${tab.name}" and all documents stored inside it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteTab(tab.uuid) }
        ]
      );
    }
  };

  const handleConfirmDeleteTab = (tab: any) => {
    if (tab.isSensitive === 1 && tab.tabPinHash) {
      requestTabPin(tab, 'delete');
      return;
    }
    showDeleteTabPrompt(tab);
  };

  const confirmDeleteTabAction = () => {
    if (!deleteConfirmTab) return;
    deleteTab(deleteConfirmTab.uuid);
    setDeleteConfirmTab(null);
  };

  const handlePerformExport = async () => {
    if (exportPin.length < BACKUP_PASSWORD_MIN || exportPin !== exportPinConfirm) return;
    setIsExporting(true);
    try {
      await exportBackup(exportPin);
      closeExportModal();
      Alert.alert('Success', 'Backup file exported successfully.');
    } catch (e: any) {
      Alert.alert('Export Error', e?.message || 'Failed to export backup.');
    } finally {
      setIsExporting(false);
    }
  };

  const readFileFromAsset = async (asset: any): Promise<string> => {
    if (Platform.OS === 'web') {
      if (asset.file) {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string) || '');
          reader.onerror = (err) => reject(err);
          reader.readAsText(asset.file as File);
        });
      } else if (asset.uri) {
        const res = await fetch(asset.uri);
        return res.text();
      }
      return '';
    } else {
      try {
        return await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
      } catch {
        const res = await fetch(asset.uri);
        return res.text();
      }
    }
  };

  // Native: DocumentPicker called directly from within a fully-presented modal (safe)
  const handlePickFileNative = async () => {
    if (isReadingFile || isImporting) return;
    setIsReadingFile(true);
    try {
      const result = await withoutAutoLock(() => DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      }));

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const fileName = asset.name || '';

        if (!fileName.toLowerCase().endsWith('.olocker')) {
          Alert.alert('Invalid File', 'Please select an OfflineLocker backup file (*.olocker).');
          return;
        }

        const text = await readFileFromAsset(asset);

        if (!text || !text.trim()) {
          Alert.alert('Error', 'The selected backup file appears to be empty or inaccessible.');
          return;
        }

        setPickedFileName(fileName);
        setPickedFileContent(text.trim());
      }
    } catch (err: any) {
      console.error('File pick error:', err);
      Alert.alert('File Picker Error', err?.message || 'Could not open the file picker. Please try again.');
    } finally {
      setIsReadingFile(false);
    }
  };

  const handlePerformImport = async () => {
    if (isImportingRef.current || isImporting) return;
    if (!pickedFileContent || importPin.length < 4) return;

    isImportingRef.current = true;
    setIsImporting(true);

    setTimeout(async () => {
      try {
        const res = await importBackup(pickedFileContent, importPin);
        setImportModalVisible(false);
        setImportPin('');
        setPickedFileContent(null);
        setPickedFileName(null);
        Alert.alert(
          'Backup Restored',
          `Restored ${res.tabsCount} tabs, ${res.docsCount} documents, ${res.diaryCount} diary pages and ${res.notesCount} notes.`
        );
      } catch (e: any) {
        Alert.alert('Import Error', e?.message || 'Failed to import backup. Incorrect PIN or invalid file.');
      } finally {
        isImportingRef.current = false;
        setIsImporting(false);
      }
    }, 100);
  };

  const handleOpenAccountModal = () => {
    setAccountUsername(currentUser?.username || '');
    setAccountCurrentPin('');
    setAccountNewPin('');
    setAccountConfirmNewPin('');
    setShowCurrentPin(false);
    setShowNewPin(false);
    setIsEditingUsername(false);
    setIsEditingNewPin(false);
    setAccountError(null);
    setAccountDefaultTab(defaultHomeTab);
    setTabPickerOpen(false);
    BiometricService.isEnabled(currentUser?.uuid, BiometricScopes.app).then(on => {
      setAccountBiometric(on);
      setAccountBiometricInitial(on);
    });
    setAccountModalVisible(true);
  };

  const showAccountFeedback = (title: string, msg: string) => {
    setAccountError(msg);
    if (Platform.OS === 'web') {
      window.alert(`${title}: ${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  const handleUpdateAccount = async () => {
    setAccountError(null);

    // 1. Check if user clicked save without entering old pin
    if (!accountCurrentPin.trim()) {
      showAccountFeedback('Current PIN Required', 'Please enter your current PIN to save changes.');
      return;
    }

    if (accountCurrentPin.trim().length !== currentPinLength) {
      showAccountFeedback('Invalid Current PIN', `Current PIN must be exactly ${currentPinLength} digits.`);
      return;
    }

    // 2. Check if entered old PIN is incorrect
    if (currentUser && !verifyAppPin(accountCurrentPin)) {
      showAccountFeedback('Incorrect PIN', `Incorrect current PIN. Please enter your correct ${currentPinLength}-digit PIN.`);
      return;
    }

    const isUsernameChanged = isEditingUsername && accountUsername.trim() !== (currentUser?.username || '');
    const isPinChanged = isEditingNewPin;
    const isBiometricChanged = accountBiometric !== accountBiometricInitial;

    // 3. Check if any fields were actually changed
    if (!isUsernameChanged && !isPinChanged && !isBiometricChanged) {
      showAccountFeedback('No Changes', 'Please click Edit on Username or New PIN, or change biometric unlock, before saving.');
      return;
    }

    // Only the biometric switch moved: the PIN has been checked, nothing else to rewrite
    if (!isUsernameChanged && !isPinChanged) {
      if (currentUser) {
        if (accountBiometric) await BiometricService.enable(currentUser.uuid, BiometricScopes.app);
        else await BiometricService.disable(currentUser.uuid, BiometricScopes.app);
      }
      setAccountBiometricInitial(accountBiometric);
      setAccountModalVisible(false);
      setAccountCurrentPin('');
      setAccountError(null);
      Alert.alert('Success', accountBiometric ? 'Biometric unlock enabled.' : 'Biometric unlock disabled.');
      return;
    }

    if (isEditingUsername && !accountUsername.trim()) {
      showAccountFeedback('Invalid Username', 'Username cannot be empty.');
      return;
    }

    if (isPinChanged) {
      if (!accountNewPin.trim()) {
        showAccountFeedback('Enter New PIN', `Please enter a ${NEW_PIN_LENGTH}-digit new PIN.`);
        return;
      }
      if (!new RegExp(`^\\d{${NEW_PIN_LENGTH}}$`).test(accountNewPin.trim())) {
        showAccountFeedback('Invalid New PIN', `New PIN must be exactly ${NEW_PIN_LENGTH} digits.`);
        return;
      }
      if (!accountConfirmNewPin.trim()) {
        showAccountFeedback('Confirm New PIN', `Please re-enter and confirm your new ${NEW_PIN_LENGTH}-digit PIN.`);
        return;
      }
      if (accountNewPin.trim() !== accountConfirmNewPin.trim()) {
        showAccountFeedback('PIN Mismatch', 'New PIN and Confirm New PIN do not match.');
        return;
      }
    }

    setIsUpdatingAccount(true);
    try {
      const res = await updateUserProfile(
        accountCurrentPin.trim(),
        isUsernameChanged ? accountUsername.trim() : undefined,
        isPinChanged ? accountNewPin.trim() : undefined
      );

      if (res.success) {
        if (isBiometricChanged && currentUser) {
          if (accountBiometric) await BiometricService.enable(currentUser.uuid, BiometricScopes.app);
          else await BiometricService.disable(currentUser.uuid, BiometricScopes.app);
          setAccountBiometricInitial(accountBiometric);
        }
        if (Platform.OS === 'web') {
          window.alert(`Success: ${res.message}`);
        } else {
          Alert.alert('Success', res.message);
        }
        setAccountModalVisible(false);
        setAccountCurrentPin('');
        setAccountNewPin('');
        setAccountConfirmNewPin('');
        setIsEditingUsername(false);
        setIsEditingNewPin(false);
        setAccountError(null);
      } else {
        showAccountFeedback('Error', res.message);
      }
    } catch (e: any) {
      showAccountFeedback('Error', e?.message || 'Failed to update profile.');
    } finally {
      setIsUpdatingAccount(false);
    }
  };

  const handleCreateTab = async () => {
    const trimmed = tabName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please enter a tab name.');
      return;
    }
    const isDuplicate = tabs.some(
      t => t.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      Alert.alert('Duplicate Tab Name', `A tab named "${trimmed}" already exists. Please choose a different name.`);
      return;
    }

    if (isSensitive) {
      if (!new RegExp(`^\\d{${NEW_PIN_LENGTH}}$`).test(tabPin.trim())) {
        Alert.alert('Invalid PIN', `Sensitive tabs require a ${NEW_PIN_LENGTH}-digit PIN.`);
        return;
      }
      if (!confirmTabPin.trim()) {
        Alert.alert('Confirm Tab PIN', `Please confirm your ${NEW_PIN_LENGTH}-digit Tab PIN.`);
        return;
      }
      if (tabPin.trim() !== confirmTabPin.trim()) {
        Alert.alert('PIN Mismatch', 'Tab PIN and Confirm Tab PIN do not match.');
        return;
      }
    }

    const success = await createTab(tabName, tabDesc, isSensitive, tabPin, isSensitive && tabBiometric);
    if (success) {
      closeCreateTab();
    } else {
      Alert.alert('Error', `Failed to create tab. Ensure sensitive tabs have a ${NEW_PIN_LENGTH}-digit PIN.`);
    }
  };

  const isNavigatingRef = useRef(false);

  const handleTabPress = (tab: any) => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setTimeout(() => { isNavigatingRef.current = false; }, 500);

    if (tab.isSensitive === 1) {
      requestTabPin(tab, 'open');
    } else {
      navigation.navigate('TabDetail', { tabId: tab.uuid, tabName: tab.name });
    }
  };

  /** What happens once the tab's PIN is known, whether it was typed or handed back by a scan. */
  const proceedWithTab = (tab: any, target: 'open' | 'edit' | 'delete', pin: string) => {
    setPinModalVisible(false);
    setUnlockPin('');
    if (target === 'edit') {
      openEditTabModal(tab, pin);
    } else if (target === 'delete') {
      showDeleteTabPrompt(tab);
    } else {
      navigation.navigate('TabDetail', { tabId: tab.uuid, tabName: tab.name, unlockPin: pin });
    }
  };

  /**
   * Biometrics first, the PIN box when that is off, cancelled or fails. The
   * PIN a scan returns is still checked against the tab: one saved before the
   * tab's PIN changed elsewhere (a restored backup) must not open it.
   */
  const tryTabBiometric = async (tab: any, target: 'open' | 'edit' | 'delete'): Promise<boolean> => {
    const scope = BiometricScopes.tab(tab.uuid);
    const verb = target === 'edit' ? 'edit' : target === 'delete' ? 'delete' : 'unlock';
    const pin = await BiometricService.unlock(currentUser?.uuid, scope, `Verify to ${verb} ${tab.name}`);
    if (!pin) return false;
    if (!verifyTabPin(tab, pin)) {
      await BiometricService.disable(currentUser?.uuid, scope);
      return false;
    }
    proceedWithTab(tab, target, pin);
    return true;
  };

  const requestTabPin = async (tab: any, target: 'open' | 'edit' | 'delete') => {
    setSelectedTab(tab);
    setPinActionTarget(target);
    setUnlockPin('');
    const enabled = await BiometricService.isEnabled(currentUser?.uuid, BiometricScopes.tab(tab.uuid));
    setTabBiometricOn(enabled);
    if (enabled && await tryTabBiometric(tab, target)) return;
    setPinModalVisible(true);
  };

  const handleUnlockTab = () => {
    if (selectedTab && verifyTabPin(selectedTab, unlockPin)) {
      proceedWithTab(selectedTab, pinActionTarget, unlockPin);
    } else {
      Alert.alert('Error', 'Incorrect PIN');
    }
  };

  const handleSignOut = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to sign out?')) {
        logout();
      }
    } else {
      Alert.alert(
        'Sign Out',
        'Are you sure you want to sign out of your vault?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign Out', style: 'destructive', onPress: logout }
        ]
      );
    }
  };

  React.useLayoutEffect(() => {
    // On a 320dp phone the title and these buttons do not both fit at full
    // size, and the title was ending up underneath them
    const isNarrow = screenWidth < 360;

    navigation.setOptions({
      headerTitle: () => (
        // Capped here rather than through headerTitleContainerStyle, which the
        // native stack does not take: without a bound the title keeps its
        // natural width and slides under the buttons instead of shortening
        <View style={{ flexDirection: 'row', alignItems: 'center', maxWidth: screenWidth - (isNarrow ? 150 : 200) }}>
          <View style={{
            width: isNarrow ? 28 : 32,
            height: isNarrow ? 28 : 32,
            borderRadius: 10,
            backgroundColor: AppTheme.colors.primary,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: isNarrow ? 8 : 10,
          }}>
            <Ionicons name="lock-closed" size={isNarrow ? 16 : 18} color="#ffffff" />
          </View>
          <Text
            numberOfLines={1}
            style={{ fontSize: isNarrow ? 16 : 20, fontWeight: '700', color: AppTheme.colors.text, flexShrink: 1 }}
          >
            OfflineLocker
          </Text>
        </View>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={() => setSettingsMenuVisible(true)}
            style={{ 
              alignItems: 'center', 
              justifyContent: 'center',
              backgroundColor: AppTheme.colors.cardBackground, 
              width: isNarrow ? 32 : 36,
              height: isNarrow ? 32 : 36,
              borderRadius: 18, 
              borderWidth: 1, 
              borderColor: AppTheme.colors.border, 
              marginRight: isNarrow ? 6 : 8
            }}
            accessibilityLabel="Settings"
            {...(Platform.OS === 'web' ? { title: 'Settings' } : {})}
          >
            <Ionicons name="settings-outline" size={isNarrow ? 18 : 20} color={AppTheme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setBackupModalVisible(true)} 
            style={{ 
              alignItems: 'center', 
              justifyContent: 'center',
              backgroundColor: AppTheme.colors.primaryLight, 
              paddingHorizontal: isNarrow ? 8 : 14,
              paddingVertical: isNarrow ? 6 : 7,
              borderRadius: 20, 
              borderWidth: 1, 
              borderColor: AppTheme.colors.primaryBorder, 
              marginRight: isNarrow ? 6 : 10
            }}
            {...(Platform.OS === 'web' ? { title: 'Backup & Restore Vault Data' } : {})}
          >
            {/* The word does not fit on the narrowest phones, and losing it
                there is better than losing the app's own name */}
            {isNarrow ? (
              <Ionicons name="save-outline" size={17} color={AppTheme.colors.primary} />
            ) : (
              <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13 }}>Backup</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={handleSignOut} 
            style={{ padding: 4, marginRight: 6 }}
            accessibilityLabel="Sign out"
            {...(Platform.OS === 'web' ? { title: 'Sign Out' } : {})}
          >
            <Ionicons name="power-outline" size={17} color={AppTheme.colors.primary} />
          </TouchableOpacity>
        </View>
      )
    });
    // screenWidth matters: the header lays out differently on a narrow phone
  }, [navigation, currentUser, screenWidth]);

  const renderWithTooltip = (element: React.ReactElement, tooltipText: string, display: 'inline-flex' | 'flex' | 'block' = 'inline-flex') => {
    if (Platform.OS === 'web' && tooltipText) {
      return React.createElement('div', { title: tooltipText, style: { display, cursor: 'pointer', maxWidth: '100%', alignItems: 'center' } }, element);
    }
    return element;
  };

  const renderHomeTabs = () => (
    <View style={[styles.homeTabBar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {HOME_TAB_OPTIONS.map(tab => {
        const active = homeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setHomeTab(tab.key)}
            style={[styles.homeTabItem, active && styles.homeTabItemActive]}
            activeOpacity={0.7}
          >
            <Ionicons
              name={(active ? tab.icon : `${tab.icon}-outline`) as any}
              size={20}
              color={active ? AppTheme.colors.primary : AppTheme.colors.textSecondary}
            />
            <Text style={[styles.homeTabLabel, active && styles.homeTabLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={styles.container}>
      {homeTab === 'diary' && <DiaryView isMobile={isMobile} />}
      {homeTab === 'notes' && <NotesView isMobile={isMobile} />}

      {homeTab === 'files' && (
      <FlatList
        style={{ flex: 1 }}
        data={sortedTabs}
        keyExtractor={item => item.uuid}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        contentContainerStyle={{ padding: AppTheme.spacing.m, paddingBottom: 100 }}
        ListHeaderComponent={
          <View style={styles.sectionHeaderContainer}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Text style={styles.sectionTitle}>Your document categories</Text>
                <Text style={styles.sectionSubtitle}>Organize and protect what matters.</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSortModalVisible(true)}
                style={styles.sortFilterBtn}
                {...(Platform.OS === 'web' ? { title: 'Sort categories' } : {})}
              >
                <Ionicons name="swap-vertical" size={15} color={AppTheme.colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sortFilterBtnText}>{getSortLabel(sortOption)}</Text>
                <Ionicons name="chevron-down" size={13} color={AppTheme.colors.textSecondary} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            </View>
          </View>
        }
        renderItem={({ item }) => {
          const docCount = tabDocCounts[item.uuid] || 0;
          return renderWithTooltip(
            <TouchableOpacity 
              style={styles.tabCard} 
              onPress={() => handleTabPress(item)}
            >
              {/* Category Folder Icon Badge */}
              <View style={styles.folderIconContainer}>
                <Ionicons 
                  name="folder" 
                  size={18} 
                  color={AppTheme.colors.primary} 
                />
                {item.isSensitive === 1 && (
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={8} color="#fff" />
                  </View>
                )}
              </View>

              {/* Category Text & Pill Count */}
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={styles.tabName}>{item.name}</Text>
                <Text style={styles.tabDesc}>{item.description}</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>
                    {docCount} {docCount === 1 ? 'item' : 'items'}
                  </Text>
                </View>
              </View>

              {/* Action Buttons & Chevron */}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity 
                  onPress={(e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    handleOpenEditTab(item);
                  }} 
                  style={styles.editBtn}
                  {...(Platform.OS === 'web' ? { title: `Edit ${item.name}` } : {})}
                >
                  <Ionicons name="create-outline" size={18} color={AppTheme.colors.text} />
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={(e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    handleConfirmDeleteTab(item);
                  }} 
                  style={styles.deleteBtn}
                  {...(Platform.OS === 'web' ? { title: `Delete ${item.name}` } : {})}
                >
                  <Ionicons name="trash-outline" size={18} color={AppTheme.colors.error} />
                </TouchableOpacity>

                <Ionicons name="chevron-forward" size={20} color={AppTheme.colors.textMuted} style={{ marginLeft: 10 }} />
              </View>
            </TouchableOpacity>,
            `Open ${item.name} Vault Category`,
            'block'
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>No tabs available. Create one below.</Text>}
      />
      )}

      {homeTab === 'files' && (
        <DraggableFAB onPress={() => setModalVisible(true)} initialBottom={96 + insets.bottom} />
      )}

      {renderHomeTabs()}

      {/* CREATE TAB MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]}>New Vault Tab</Text>
              <ModalCloseButton onPress={closeCreateTab} />
            </View>
            <TextInput style={[styles.input, { letterSpacing: 0 }]} placeholder="Tab Name" placeholderTextColor={AppTheme.colors.textSecondary} value={tabName} onChangeText={setTabName} />
            <TextInput style={[styles.input, { letterSpacing: 0 }]} placeholder="Description" placeholderTextColor={AppTheme.colors.textSecondary} value={tabDesc} onChangeText={setTabDesc} />
            
            <TouchableOpacity style={styles.checkboxRow} onPress={() => setIsSensitive(!isSensitive)}>
              <Ionicons name={isSensitive ? "checkbox" : "square-outline"} size={24} color={AppTheme.colors.primary} />
              <Text style={styles.checkboxText}>Sensitive Tab (Requires PIN)</Text>
            </TouchableOpacity>

            {isSensitive && (
              <>
                <TextInput 
                  style={[styles.input, { letterSpacing: tabPin ? 6 : 0 }]} 
                  placeholder={`${NEW_PIN_LENGTH}-Digit Tab PIN`} 
                  placeholderTextColor={AppTheme.colors.textSecondary} 
                  value={tabPin} 
                  onChangeText={(t) => setTabPin(t.replace(/[^0-9]/g, '').slice(0, NEW_PIN_LENGTH))} 
                  keyboardType="numeric" 
                  secureTextEntry 
                  maxLength={NEW_PIN_LENGTH} 
                />
                <TextInput 
                  style={[
                    styles.input, 
                    { letterSpacing: confirmTabPin ? 6 : 0 },
                    tabPin.length === NEW_PIN_LENGTH && confirmTabPin.length === NEW_PIN_LENGTH && tabPin !== confirmTabPin && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
                  ]} 
                  placeholder={`Confirm ${NEW_PIN_LENGTH}-Digit Tab PIN`} 
                  placeholderTextColor={AppTheme.colors.textSecondary} 
                  value={confirmTabPin} 
                  onChangeText={(t) => setConfirmTabPin(t.replace(/[^0-9]/g, '').slice(0, NEW_PIN_LENGTH))} 
                  keyboardType="numeric" 
                  secureTextEntry 
                  maxLength={NEW_PIN_LENGTH} 
                />
                {tabPin.length === NEW_PIN_LENGTH && confirmTabPin.length === NEW_PIN_LENGTH && tabPin !== confirmTabPin && (
                  <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginTop: -8, marginBottom: 8, fontWeight: '600' }}>
                    Tab PIN and Confirm Tab PIN do not match.
                  </Text>
                )}
                <BiometricToggle
                  value={tabBiometric}
                  onChange={setTabBiometric}
                  disabled={tabPin.length !== NEW_PIN_LENGTH || tabPin !== confirmTabPin}
                />
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={closeCreateTab} 
                style={[styles.button, { backgroundColor: AppTheme.colors.border }]}
              >
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isCreateDisabled = !tabName.trim() || (isSensitive && (tabPin.trim().length !== NEW_PIN_LENGTH || confirmTabPin.trim().length !== NEW_PIN_LENGTH || tabPin.trim() !== confirmTabPin.trim()));
                return (
                  <TouchableOpacity 
                    onPress={handleCreateTab} 
                    disabled={isCreateDisabled} 
                    style={[styles.button, isCreateDisabled && { backgroundColor: AppTheme.colors.border, opacity: 0.5 }]}
                  >
                    <Text style={[styles.buttonText, isCreateDisabled && { color: AppTheme.colors.textSecondary }]}>Create</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT TAB MODAL */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]}>Edit Vault Tab</Text>
              <ModalCloseButton onPress={closeEditTab} />
            </View>
            <TextInput 
              style={[styles.input, { letterSpacing: 0 }]} 
              placeholder="Tab Name" 
              placeholderTextColor={AppTheme.colors.textSecondary} 
              value={editTabName} 
              onChangeText={setEditTabName} 
            />
            <TextInput 
              style={[styles.input, { letterSpacing: 0 }]} 
              placeholder="Description" 
              placeholderTextColor={AppTheme.colors.textSecondary} 
              value={editTabDesc} 
              onChangeText={setEditTabDesc} 
            />

            <TouchableOpacity style={styles.checkboxRow} onPress={() => setEditIsSensitive(!editIsSensitive)}>
              <Ionicons name={editIsSensitive ? "checkbox" : "square-outline"} size={24} color={AppTheme.colors.primary} />
              <Text style={styles.checkboxText}>Sensitive Tab (Requires PIN)</Text>
            </TouchableOpacity>

            {editIsSensitive && (
              <>
                <TextInput
                  style={[styles.input, { letterSpacing: editTabPin ? 6 : 0 }]}
                  placeholder={`New ${NEW_PIN_LENGTH}-Digit Tab PIN (optional to keep current)`}
                  placeholderTextColor={AppTheme.colors.textSecondary}
                  value={editTabPin}
                  onChangeText={(t) => setEditTabPin(t.replace(/[^0-9]/g, '').slice(0, NEW_PIN_LENGTH))}
                  keyboardType="numeric"
                  secureTextEntry
                  maxLength={NEW_PIN_LENGTH}
                />
                <TextInput
                  style={[
                    styles.input,
                    { letterSpacing: editConfirmTabPin ? 6 : 0 },
                    editTabPin.length === NEW_PIN_LENGTH && editConfirmTabPin.length === NEW_PIN_LENGTH && editTabPin !== editConfirmTabPin && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
                  ]}
                  placeholder={`Confirm New ${NEW_PIN_LENGTH}-Digit Tab PIN`}
                  placeholderTextColor={AppTheme.colors.textSecondary}
                  value={editConfirmTabPin}
                  onChangeText={(t) => setEditConfirmTabPin(t.replace(/[^0-9]/g, '').slice(0, NEW_PIN_LENGTH))}
                  keyboardType="numeric"
                  secureTextEntry
                  maxLength={NEW_PIN_LENGTH}
                />
                {editTabPin.length === NEW_PIN_LENGTH && editConfirmTabPin.length === NEW_PIN_LENGTH && editTabPin !== editConfirmTabPin && (
                  <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginTop: -8, marginBottom: 8, fontWeight: '600' }}>
                    New Tab PIN and Confirm Tab PIN do not match.
                  </Text>
                )}
                {/* Needs a PIN to hand back: the one verified on the way in, or a new one */}
                <BiometricToggle
                  value={editTabBiometric}
                  onChange={setEditTabBiometric}
                  disabled={editTabPin
                    ? editTabPin.length !== NEW_PIN_LENGTH || editTabPin !== editConfirmTabPin
                    : !editKnownPin}
                />
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={closeEditTab} 
                style={[styles.button, { backgroundColor: AppTheme.colors.border }]}
              >
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleSaveEditTab} 
                disabled={!editTabName.trim()} 
                style={[styles.button, !editTabName.trim() && { backgroundColor: AppTheme.colors.border, opacity: 0.5 }]}
              >
                <Text style={[styles.buttonText, !editTabName.trim() && { color: AppTheme.colors.textSecondary }]}>Save Changes</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* UNLOCK TAB MODAL */}
      <Modal visible={pinModalVisible} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]}>
                {pinActionTarget === 'edit'
                  ? `Verify PIN to Edit ${selectedTab?.name}`
                  : pinActionTarget === 'delete'
                  ? `Verify PIN to Delete ${selectedTab?.name}`
                  : `Unlock ${selectedTab?.name}`}
              </Text>
              <ModalCloseButton onPress={closePinModal} />
            </View>
            <TextInput 
              style={[styles.input, { letterSpacing: unlockPin ? 6 : 0 }]} 
              placeholder={`${unlockPinLength}-Digit PIN`}
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={unlockPin}
              onChangeText={(t) => setUnlockPin(t.replace(/[^0-9]/g, '').slice(0, unlockPinLength))} 
              keyboardType="numeric" 
              secureTextEntry 
              maxLength={NEW_PIN_LENGTH} 
            />
            {tabBiometricOn && selectedTab && (
              <BiometricUnlockButton onPress={() => tryTabBiometric(selectedTab, pinActionTarget)} style={{ marginBottom: 12 }} />
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setPinModalVisible(false); setUnlockPin(''); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isUnlockDisabled = unlockPin.trim().length !== unlockPinLength;
                return (
                  <TouchableOpacity 
                    onPress={handleUnlockTab} 
                    disabled={isUnlockDisabled} 
                    style={[styles.button, isUnlockDisabled && { backgroundColor: AppTheme.colors.border, opacity: 0.5 }]}
                  >
                    <Text style={[styles.buttonText, isUnlockDisabled && { color: AppTheme.colors.textSecondary }]}>
                      {pinActionTarget === 'open' ? 'Unlock' : 'Verify'}
                    </Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* UNIFIED BACKUP MENU MODAL */}
      <Modal visible={backupModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: AppTheme.spacing.m }}>
              <Text style={styles.modalTitle}>Vault Backup & Restore</Text>
              <TouchableOpacity onPress={() => setBackupModalVisible(false)}>
                <Ionicons name="close-circle-outline" size={24} color={AppTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: AppTheme.colors.textSecondary, marginBottom: AppTheme.spacing.l, fontSize: 13 }}>
              Export your encrypted vault to Google Drive, OneDrive, or local files, or import an existing backup.
            </Text>

            {/* Option 1: EXPORT */}
            <TouchableOpacity 
              onPress={() => { setBackupModalVisible(false); setExportModalVisible(true); }}
              style={{ backgroundColor: AppTheme.colors.surface, padding: 16, borderRadius: AppTheme.borderRadius.m, borderWidth: 1, borderColor: AppTheme.colors.border, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0, 122, 255, 0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Ionicons name="cloud-upload-outline" size={24} color={AppTheme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: AppTheme.colors.text }}>Export Backup</Text>
                <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, marginTop: 2 }}>
                  Encrypt & save to OneDrive, Google Drive, or Local Files
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={AppTheme.colors.textSecondary} />
            </TouchableOpacity>

            {/* Option 2: IMPORT */}
            <TouchableOpacity 
              onPress={() => {
                setPickedFileName(null);
                setPickedFileContent(null);
                setImportPin('');
                setBackupModalVisible(false);
                setImportModalVisible(true);
              }}
              style={{ backgroundColor: AppTheme.colors.surface, padding: 16, borderRadius: AppTheme.borderRadius.m, borderWidth: 1, borderColor: AppTheme.colors.border, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(52, 199, 89, 0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Ionicons name="cloud-download-outline" size={24} color="#34c759" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: 'bold', color: AppTheme.colors.text }}>Import Backup</Text>
                <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, marginTop: 2 }}>
                  Browse phone files (Google Drive, OneDrive, Storage) & restore
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={AppTheme.colors.textSecondary} />
            </TouchableOpacity>


            <TouchableOpacity onPress={() => setBackupModalVisible(false)} style={[styles.button, { backgroundColor: AppTheme.colors.border, marginTop: 8 }]}>
              <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Close</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SETTINGS CHOOSER: who you are, and how the app behaves */}
      <Modal visible={settingsMenuVisible} animationType="fade" transparent onRequestClose={() => setSettingsMenuVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSettingsMenuVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { paddingBottom: 8 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: AppTheme.spacing.m }}>
              <Text style={styles.modalTitle}>Settings</Text>
              <TouchableOpacity onPress={() => setSettingsMenuVisible(false)}>
                <Ionicons name="close-circle-outline" size={24} color={AppTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {[
              {
                key: 'profile',
                icon: 'person-outline' as const,
                title: 'Profile settings',
                subtitle: 'Your username and unlock PIN',
                onPress: () => { setSettingsMenuVisible(false); handleOpenAccountModal(); },
              },
              {
                key: 'app',
                icon: 'options-outline' as const,
                title: 'App settings',
                subtitle: 'Launch page and theme',
                onPress: () => {
                  setSettingsMenuVisible(false);
                  setAccountDefaultTab(defaultHomeTab);
                  setTabPickerOpen(false);
                  setAppSettingsVisible(true);
                },
              },
              {
                key: 'help',
                icon: 'help-circle-outline' as const,
                title: 'Help',
                subtitle: 'What OfflineLocker is and how it keeps you safe',
                onPress: () => { setSettingsMenuVisible(false); setHelpVisible(true); },
              },
            ].map(item => (
              <TouchableOpacity key={item.key} onPress={item.onPress} style={styles.settingsRow} activeOpacity={0.7}>
                <View style={styles.settingsRowIcon}>
                  <Ionicons name={item.icon} size={19} color={AppTheme.colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsRowTitle}>{item.title}</Text>
                  <Text style={styles.settingsRowSubtitle}>{item.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={AppTheme.colors.textMuted} />
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* HELP: what the app is, what it is for, and why the PIN matters */}
      <Modal visible={helpVisible} animationType="slide" transparent onRequestClose={() => setHelpVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: AppTheme.spacing.m }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: AppTheme.colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                  <Ionicons name="help-circle-outline" size={20} color={AppTheme.colors.primary} />
                </View>
                <Text style={styles.modalTitle}>Help</Text>
              </View>
              <TouchableOpacity onPress={() => setHelpVisible(false)}>
                <Ionicons name="close-circle-outline" size={24} color={AppTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.helpHeading}>What is OfflineLocker?</Text>
              <Text style={styles.helpBody}>
                OfflineLocker is a 100% offline document vault that securely stores your important personal information directly on your device. It's designed for documents like IDs, bank details, passwords, insurance information, vehicle documents, medical records, and private notes that you want to keep safe and easily accessible.
              </Text>
              <Text style={styles.helpBody}>
                Your data never leaves your device. Everything is stored locally, and OfflineLocker does not upload, sync, or send your information to any server or cloud service. No personal data is collected or transmitted outside your device.
              </Text>
              <Text style={styles.helpBody}>
                It works even in Airplane Mode, so your documents are always available—anytime, anywhere, without an internet connection.
              </Text>

              <Text style={styles.helpHeading}>What can I use it for?</Text>
              {[
                'Store passport, national ID, driving licence, and tax ID details.',
                'Save bank account and card information securely.',
                'Keep insurance and medical records in one place.',
                'Store Wi-Fi passwords, recovery codes, and private notes.',
                'Organize documents into categories for quick and easy access.',
              ].map(line => (
                <View key={line} style={styles.helpBullet}>
                  <Text style={styles.helpBulletDot}>{'•'}</Text>
                  <Text style={[styles.helpBody, { flex: 1, marginBottom: 0 }]}>{line}</Text>
                </View>
              ))}

              <Text style={styles.helpHeading}>Why is the PIN important?</Text>
              {[
                'Your PIN is the first layer of protection for your vault.',
                'It prevents unauthorized access if someone uses your phone.',
                'The PIN is required to unlock your stored information.',
                "Choose a PIN that's difficult to guess and don't share it with anyone.",
              ].map(line => (
                <View key={line} style={styles.helpBullet}>
                  <Text style={styles.helpBulletDot}>{'•'}</Text>
                  <Text style={[styles.helpBody, { flex: 1, marginBottom: 0 }]}>{line}</Text>
                </View>
              ))}
              <Text style={[styles.helpBody, { marginTop: 6 }]}>
                If your device supports Fingerprint or Face ID, you can use biometrics for quicker access while keeping your PIN as a secure backup.
              </Text>

              <View style={styles.helpCallout}>
                <Ionicons name="shield-checkmark-outline" size={18} color={AppTheme.colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
                <Text style={[styles.helpBody, { flex: 1, marginBottom: 0 }]}>
                  <Text style={{ fontWeight: '700', color: AppTheme.colors.text }}>Privacy First: </Text>
                  OfflineLocker is built around local-first privacy. Your information stays on your device and remains under your control.
                </Text>
              </View>

              <TouchableOpacity onPress={() => setHelpVisible(false)} style={styles.button}>
                <Text style={styles.buttonText}>Got it</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* APP SETTINGS: preferences, so each one saves as it is chosen */}
      <Modal visible={appSettingsVisible} animationType="slide" transparent onRequestClose={() => setAppSettingsVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: AppTheme.spacing.m }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: AppTheme.colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                    <Ionicons name="options-outline" size={20} color={AppTheme.colors.primary} />
                  </View>
                  <Text style={styles.modalTitle}>App settings</Text>
                </View>
                <TouchableOpacity onPress={() => setAppSettingsVisible(false)}>
                  <Ionicons name="close-circle-outline" size={24} color={AppTheme.colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Which tab the app opens on */}
              <Text style={styles.label}>Launch page</Text>
              <TouchableOpacity
                onPress={() => setTabPickerOpen(!tabPickerOpen)}
                style={[styles.tabPickerBtn, { marginTop: 6 }]}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={HOME_TAB_OPTIONS.find(o => o.key === accountDefaultTab)?.icon || 'folder'}
                  size={17}
                  color={AppTheme.colors.primary}
                  style={{ marginRight: 9 }}
                />
                <Text style={styles.tabPickerText}>
                  {HOME_TAB_OPTIONS.find(o => o.key === accountDefaultTab)?.label || 'Files'}
                </Text>
                <Ionicons
                  name={tabPickerOpen ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={AppTheme.colors.textSecondary}
                />
              </TouchableOpacity>

              {tabPickerOpen && (
                <View style={styles.tabPickerList}>
                  {HOME_TAB_OPTIONS.map(option => {
                    const selected = option.key === accountDefaultTab;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        onPress={() => {
                          // A preference, not a credential: it saves on the spot
                          setAccountDefaultTab(option.key);
                          setTabPickerOpen(false);
                          setDefaultHomeTab(option.key);
                        }}
                        style={[styles.tabPickerItem, selected && styles.tabPickerItemActive]}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={option.icon}
                          size={16}
                          color={selected ? AppTheme.colors.primary : AppTheme.colors.textSecondary}
                          style={{ marginRight: 9 }}
                        />
                        <Text style={[styles.tabPickerItemText, selected && styles.tabPickerItemTextActive]}>
                          {option.label}
                        </Text>
                        {selected && <Ionicons name="checkmark" size={16} color={AppTheme.colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Accent */}
              <Text style={[styles.label, { marginTop: 18 }]}>Theme</Text>
              <Text style={styles.settingsRowSubtitle}>The colour the whole app is drawn in.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                {ACCENTS.map(option => {
                  const selected = option.key === accentKey;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setAccent(option.key)}
                      style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                      accessibilityLabel={option.label}
                      activeOpacity={0.7}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: option.primary,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? option.primaryBorder : 'rgba(15,23,42,0.08)',
                        }}
                      >
                        {selected && <Ionicons name="checkmark" size={15} color="#ffffff" />}
                      </View>
                      <Text
                        style={{
                          fontSize: 10,
                          marginTop: 4,
                          fontWeight: selected ? '700' : '500',
                          color: selected ? AppTheme.colors.text : AppTheme.colors.textSecondary,
                        }}
                        numberOfLines={1}
                      >
                        {option.label}
                      </Text>
                      {option.key === DEFAULT_ACCENT_KEY && <Text style={styles.defaultTag}>Default</Text>}
                    </TouchableOpacity>
                  );
                })}

                {/* Whatever the user mixed. Tapping it again reopens the mixer,
                    so the colour can be adjusted rather than only replaced. */}
                <TouchableOpacity
                  onPress={() => {
                    if (accentKey !== CUSTOM_KEY) setAccent(CUSTOM_KEY);
                    setColorPickerFor('accent');
                  }}
                  style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                  accessibilityLabel="Custom theme colour"
                  activeOpacity={0.7}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: getAccent(CUSTOM_KEY, customAccent).primary,
                      borderWidth: accentKey === CUSTOM_KEY ? 2 : 1,
                      borderColor: accentKey === CUSTOM_KEY
                        ? getAccent(CUSTOM_KEY, customAccent).primaryBorder
                        : 'rgba(15,23,42,0.08)',
                    }}
                  >
                    <Ionicons
                      name={accentKey === CUSTOM_KEY ? 'brush' : 'color-palette-outline'}
                      size={14}
                      color="#ffffff"
                    />
                  </View>
                  <Text
                    style={{
                      fontSize: 10,
                      marginTop: 4,
                      fontWeight: accentKey === CUSTOM_KEY ? '700' : '500',
                      color: accentKey === CUSTOM_KEY ? AppTheme.colors.text : AppTheme.colors.textSecondary,
                    }}
                    numberOfLines={1}
                  >
                    Custom
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Background */}
              <Text style={[styles.label, { marginTop: 6 }]}>Background</Text>
              <Text style={styles.settingsRowSubtitle}>What the app is laid out on, behind the cards.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                {BACKGROUNDS.map(option => {
                  const selected = option.key === backgroundKey;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setBackground(option.key)}
                      style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                      accessibilityLabel={option.label}
                      activeOpacity={0.7}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 11,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: option.color,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? AppTheme.colors.primary : 'rgba(15,23,42,0.12)',
                        }}
                      >
                        {selected && <Ionicons name="checkmark" size={14} color={AppTheme.colors.primary} />}
                      </View>
                      <Text
                        style={{
                          fontSize: 10,
                          marginTop: 4,
                          fontWeight: selected ? '700' : '500',
                          color: selected ? AppTheme.colors.text : AppTheme.colors.textSecondary,
                        }}
                        numberOfLines={1}
                      >
                        {option.label}
                      </Text>
                      {option.key === DEFAULT_BACKGROUND_KEY && <Text style={styles.defaultTag}>Default</Text>}
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  onPress={() => {
                    if (backgroundKey !== CUSTOM_KEY) setBackground(CUSTOM_KEY);
                    setColorPickerFor('background');
                  }}
                  style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                  accessibilityLabel="Custom background colour"
                  activeOpacity={0.7}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 11,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: getBackground(CUSTOM_KEY, customBackground).color,
                      borderWidth: backgroundKey === CUSTOM_KEY ? 2 : 1,
                      borderColor: backgroundKey === CUSTOM_KEY ? AppTheme.colors.primary : 'rgba(15,23,42,0.12)',
                    }}
                  >
                    <Ionicons
                      name={backgroundKey === CUSTOM_KEY ? 'brush' : 'color-palette-outline'}
                      size={14}
                      color={AppTheme.colors.primary}
                    />
                  </View>
                  <Text
                    style={{
                      fontSize: 10,
                      marginTop: 4,
                      fontWeight: backgroundKey === CUSTOM_KEY ? '700' : '500',
                      color: backgroundKey === CUSTOM_KEY ? AppTheme.colors.text : AppTheme.colors.textSecondary,
                    }}
                    numberOfLines={1}
                  >
                    Custom
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Top and bottom bars */}
              <Text style={[styles.label, { marginTop: 6 }]}>Bars</Text>
              <Text style={styles.settingsRowSubtitle}>The strip along the top and the tab bar at the bottom.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                {BAR_COLORS.map(option => {
                  const selected = option.key === barKey;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setBar(option.key)}
                      style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                      accessibilityLabel={option.label}
                      activeOpacity={0.7}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 11,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: option.color,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? AppTheme.colors.primary : 'rgba(15,23,42,0.12)',
                        }}
                      >
                        {selected && <Ionicons name="checkmark" size={14} color={AppTheme.colors.primary} />}
                      </View>
                      <Text
                        style={{
                          fontSize: 10,
                          marginTop: 4,
                          fontWeight: selected ? '700' : '500',
                          color: selected ? AppTheme.colors.text : AppTheme.colors.textSecondary,
                        }}
                        numberOfLines={1}
                      >
                        {option.label}
                      </Text>
                      {option.key === DEFAULT_BAR_KEY && <Text style={styles.defaultTag}>Default</Text>}
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  onPress={() => {
                    if (barKey !== CUSTOM_KEY) setBar(CUSTOM_KEY);
                    setColorPickerFor('bar');
                  }}
                  style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                  accessibilityLabel="Custom bar colour"
                  activeOpacity={0.7}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 11,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: getBar(CUSTOM_KEY, customBar).color,
                      borderWidth: barKey === CUSTOM_KEY ? 2 : 1,
                      borderColor: barKey === CUSTOM_KEY ? AppTheme.colors.primary : 'rgba(15,23,42,0.12)',
                    }}
                  >
                    <Ionicons
                      name={barKey === CUSTOM_KEY ? 'brush' : 'color-palette-outline'}
                      size={14}
                      color={AppTheme.colors.primary}
                    />
                  </View>
                  <Text
                    style={{
                      fontSize: 10,
                      marginTop: 4,
                      fontWeight: barKey === CUSTOM_KEY ? '700' : '500',
                      color: barKey === CUSTOM_KEY ? AppTheme.colors.text : AppTheme.colors.textSecondary,
                    }}
                    numberOfLines={1}
                  >
                    Custom
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={() => setAppSettingsVisible(false)} style={styles.button}>
                <Text style={styles.buttonText}>Done</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>

        {/* Inside the settings window rather than beside it: iOS presents one
            modal at a time, so a picker opened as a sibling of an open modal
            simply never appeared there. */}
        <ColorPickerModal
          visible={colorPickerFor !== null}
          value={
            colorPickerFor === 'background' ? customBackground
              : colorPickerFor === 'bar' ? customBar
                : customAccent
          }
          title={
            colorPickerFor === 'background' ? 'Custom background'
              : colorPickerFor === 'bar' ? 'Custom bar colour'
                : 'Custom theme colour'
          }
          hint={
            colorPickerFor === 'background'
              ? 'Held pale whatever you pick, so the writing on it stays readable.'
              : colorPickerFor === 'bar'
                ? 'Held pale whatever you pick: the bars carry the smallest text in the app.'
                : 'Used for buttons, icons and highlights across the app.'
          }
          onSelect={hex => {
            if (colorPickerFor === 'background') setCustomBackground(hex);
            else if (colorPickerFor === 'bar') setCustomBar(hex);
            else setCustomAccent(hex);
          }}
          onClose={() => setColorPickerFor(null)}
        />
      </Modal>

      {/* ACCOUNT SETTINGS MODAL (CHANGE USERNAME & PIN) */}
      <Modal visible={accountModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '92%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: AppTheme.spacing.m }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: AppTheme.colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                  <Ionicons name="person" size={20} color={AppTheme.colors.primary} />
                </View>
                <Text style={styles.modalTitle}>Profile settings</Text>
              </View>
              <TouchableOpacity onPress={() => setAccountModalVisible(false)}>
                <Ionicons name="close-circle-outline" size={24} color={AppTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
              {accountError && (
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#fef2f2',
                  borderColor: '#fecaca',
                  borderWidth: 1,
                  borderRadius: 8,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  marginBottom: 14,
                }}>
                  <Ionicons name="alert-circle" size={18} color={AppTheme.colors.error} style={{ marginRight: 8 }} />
                  <Text style={{ color: AppTheme.colors.error, fontSize: 13, flex: 1, fontWeight: '500' }}>
                    {accountError}
                  </Text>
                </View>
              )}

              {/* Username field */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={styles.label}>Username</Text>
              </View>
              <View style={[styles.inputWithAction, !isEditingUsername && styles.inputDisabled]}>
                <TextInput
                  ref={usernameInputRef}
                  editable={isEditingUsername}
                  style={[
                    styles.innerInput,
                    !isEditingUsername && { color: AppTheme.colors.textSecondary }
                  ]}
                  value={accountUsername}
                  onChangeText={(t) => {
                    setAccountError(null);
                    setAccountUsername(t);
                  }}
                  placeholder="Enter username"
                  placeholderTextColor={AppTheme.colors.textSecondary}
                  autoCapitalize="words"
                />
                <TouchableOpacity
                  onPress={() => {
                    setIsEditingUsername(prev => {
                      const next = !prev;
                      if (next) {
                        setTimeout(() => usernameInputRef.current?.focus(), 100);
                      }
                      return next;
                    });
                  }}
                  style={[styles.fieldEditBtn, isEditingUsername && styles.fieldEditBtnActive]}
                >
                  <Ionicons 
                    name={isEditingUsername ? "checkmark" : "create-outline"} 
                    size={14} 
                    color={isEditingUsername ? AppTheme.colors.primary : AppTheme.colors.textSecondary} 
                    style={{ marginRight: 3 }} 
                  />
                  <Text style={{ 
                    fontSize: 12, 
                    fontWeight: '600', 
                    color: isEditingUsername ? AppTheme.colors.primary : AppTheme.colors.textSecondary 
                  }}>
                    {isEditingUsername ? 'Done' : 'Edit'}
                  </Text>
                </TouchableOpacity>
              </View>

              {currentPinLength < NEW_PIN_LENGTH && (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 12 }}>
                  <Ionicons name="shield-half-outline" size={16} color="#b45309" style={{ marginRight: 8, marginTop: 1 }} />
                  <Text style={{ flex: 1, fontSize: 12, color: '#92400e', lineHeight: 17 }}>
                    Your PIN has {currentPinLength} digits. Change it to a {NEW_PIN_LENGTH}-digit PIN below for stronger protection.
                  </Text>
                </View>
              )}

              {/* New PIN field */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 6 }}>
                <Text style={styles.label}>New PIN</Text>
                <TouchableOpacity onPress={() => setShowNewPin(!showNewPin)}>
                  <Text style={{ fontSize: 12, color: AppTheme.colors.primary, fontWeight: '600' }}>
                    {showNewPin ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.inputWithAction, !isEditingNewPin && styles.inputDisabled]}>
                <TextInput
                  ref={newPinInputRef}
                  editable={isEditingNewPin}
                  style={[
                    styles.innerInput,
                    { letterSpacing: accountNewPin ? 6 : 0, fontSize: accountNewPin ? 17 : 14 },
                    !isEditingNewPin && { color: AppTheme.colors.textSecondary }
                  ]}
                  value={accountNewPin}
                  onChangeText={(t) => {
                    setAccountError(null);
                    setAccountNewPin(t.replace(/[^0-9]/g, '').slice(0, NEW_PIN_LENGTH));
                  }}
                  placeholder={`Enter new ${NEW_PIN_LENGTH}-digit PIN`}
                  placeholderTextColor={AppTheme.colors.textSecondary}
                  keyboardType="number-pad"
                  secureTextEntry={!showNewPin}
                  maxLength={NEW_PIN_LENGTH}
                />
                <TouchableOpacity
                  onPress={() => {
                    setIsEditingNewPin(prev => {
                      const next = !prev;
                      if (next) {
                        setTimeout(() => newPinInputRef.current?.focus(), 100);
                      } else {
                        setAccountNewPin('');
                        setAccountConfirmNewPin('');
                      }
                      return next;
                    });
                  }}
                  style={[styles.fieldEditBtn, isEditingNewPin && styles.fieldEditBtnActive]}
                >
                  <Ionicons 
                    name={isEditingNewPin ? "close" : "create-outline"} 
                    size={14} 
                    color={isEditingNewPin ? AppTheme.colors.primary : AppTheme.colors.textSecondary} 
                    style={{ marginRight: 3 }} 
                  />
                  <Text style={{ 
                    fontSize: 12, 
                    fontWeight: '600', 
                    color: isEditingNewPin ? AppTheme.colors.primary : AppTheme.colors.textSecondary 
                  }}>
                    {isEditingNewPin ? 'Cancel' : 'Edit'}
                  </Text>
                </TouchableOpacity>
              </View>

              {isEditingNewPin && (
                <>
                  <Text style={[styles.label, { marginTop: 6 }]}>Confirm New PIN</Text>
                  <TextInput
                    style={[
                      styles.input, 
                      { letterSpacing: accountConfirmNewPin ? 6 : 0, fontSize: accountConfirmNewPin ? 17 : 14 },
                      accountNewPin.length === NEW_PIN_LENGTH && accountConfirmNewPin.length === NEW_PIN_LENGTH && accountNewPin !== accountConfirmNewPin && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
                    ]}
                    value={accountConfirmNewPin}
                    onChangeText={(t) => {
                      setAccountError(null);
                      setAccountConfirmNewPin(t.replace(/[^0-9]/g, '').slice(0, NEW_PIN_LENGTH));
                    }}
                    placeholder={`Re-enter new ${NEW_PIN_LENGTH}-digit PIN`}
                    placeholderTextColor={AppTheme.colors.textSecondary}
                    keyboardType="number-pad"
                    secureTextEntry={!showNewPin}
                    maxLength={NEW_PIN_LENGTH}
                  />
                  {accountNewPin.length === NEW_PIN_LENGTH && accountConfirmNewPin.length === NEW_PIN_LENGTH && accountNewPin !== accountConfirmNewPin && (
                    <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginTop: -6, marginBottom: 8, fontWeight: '600' }}>
                      New PIN and Confirm New PIN do not match.
                    </Text>
                  )}
                </>
              )}

              <BiometricToggle
                value={accountBiometric}
                onChange={(on) => { setAccountError(null); setAccountBiometric(on); }}
                style={{ marginTop: 14, marginBottom: 0 }}
              />

              {/* Divider */}
              <View style={{ height: 1, backgroundColor: AppTheme.colors.border, marginVertical: 14 }} />

              {/* Current PIN field */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={styles.label}>Current PIN <Text style={{ color: AppTheme.colors.error }}>*</Text></Text>
                <TouchableOpacity onPress={() => setShowCurrentPin(!showCurrentPin)}>
                  <Text style={{ fontSize: 12, color: AppTheme.colors.primary, fontWeight: '600' }}>
                    {showCurrentPin ? 'Hide' : 'Show'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[
                  styles.input, 
                  { letterSpacing: accountCurrentPin ? 6 : 0, fontSize: accountCurrentPin ? 17 : 14 },
                  accountError && (!accountCurrentPin.trim() || accountError.toLowerCase().includes('pin')) && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
                ]}
                value={accountCurrentPin}
                onChangeText={(t) => {
                  setAccountError(null);
                  setAccountCurrentPin(t.replace(/[^0-9]/g, '').slice(0, currentPinLength));
                }}
                placeholder={`Enter current ${currentPinLength}-digit PIN`}
                placeholderTextColor={AppTheme.colors.textSecondary}
                keyboardType="number-pad"
                secureTextEntry={!showCurrentPin}
                maxLength={NEW_PIN_LENGTH}
              />

              {/* Action buttons */}
              <TouchableOpacity 
                onPress={handleUpdateAccount} 
                disabled={isUpdatingAccount}
                style={[styles.button, { marginTop: 22, backgroundColor: isUpdatingAccount ? AppTheme.colors.textSecondary : AppTheme.colors.primary }]}
              >
                {isUpdatingAccount ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>Save Changes</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                onPress={() => setAccountModalVisible(false)} 
                disabled={isUpdatingAccount}
                style={[styles.button, { backgroundColor: AppTheme.colors.border, marginTop: 10 }]}
              >
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EXPORT BACKUP MODAL */}
      <Modal visible={exportModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]}>Export Encrypted Backup</Text>
              <ModalCloseButton onPress={closeExportModal} />
            </View>
            <Text style={{ color: AppTheme.colors.textSecondary, marginBottom: AppTheme.spacing.m, fontSize: 13 }}>
              Choose a backup password of at least {BACKUP_PASSWORD_MIN} characters. Letters, numbers and symbols make it much harder to crack. You will need this exact password to restore the backup - it cannot be recovered.
            </Text>
            <TextInput
              style={[styles.input, { letterSpacing: 0 }]}
              placeholder={`Backup password (min ${BACKUP_PASSWORD_MIN} characters)`}
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={exportPin}
              onChangeText={setExportPin}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TextInput
              style={[
                styles.input,
                { letterSpacing: 0 },
                exportPinConfirm.length > 0 && exportPin !== exportPinConfirm && { borderColor: AppTheme.colors.error, borderWidth: 1.5 },
              ]}
              placeholder="Confirm backup password"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={exportPinConfirm}
              onChangeText={setExportPinConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            {exportPinConfirm.length > 0 && exportPin !== exportPinConfirm && (
              <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginTop: -8, marginBottom: 8, fontWeight: '600' }}>
                The passwords do not match.
              </Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={closeExportModal} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isExportDisabled = exportPin.length < BACKUP_PASSWORD_MIN || exportPin !== exportPinConfirm || isExporting;
                return (
                  <TouchableOpacity
                    onPress={handlePerformExport}
                    disabled={isExportDisabled}
                    style={[styles.button, isExportDisabled && { backgroundColor: AppTheme.colors.border, opacity: 0.5 }]}
                  >
                    {isExporting ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={[styles.buttonText, isExportDisabled && { color: AppTheme.colors.textSecondary }]}>Export & Save</Text>
                    )}
                  </TouchableOpacity>
                );
              })()}
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* IMPORT BACKUP MODAL */}
      <Modal visible={importModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View 
            style={[styles.modalContent, { maxHeight: '90%' }]}
            pointerEvents={isImporting || isReadingFile ? 'none' : 'auto'}
          >
            <ScrollView contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={[styles.modalTitle, { flex: 1 }]}>Import Encrypted Backup</Text>
              <ModalCloseButton onPress={closeImportModal} />
            </View>
            
            {pickedFileName && (
              <View style={{ backgroundColor: 'rgba(6, 182, 212, 0.1)', padding: 10, borderRadius: 8, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="document-text-outline" size={20} color={AppTheme.colors.primary} style={{ marginRight: 8 }} />
                <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13, flex: 1 }} numberOfLines={1}>
                  File: {pickedFileName}
                </Text>
              </View>
            )}

            <Text style={{ color: AppTheme.colors.textSecondary, marginBottom: AppTheme.spacing.m, fontSize: 13 }}>
              Enter the backup password that was used to export this file. Backups made before this update use their 4-digit PIN instead.
            </Text>

            {/* Web file input is rendered to document.body via useEffect — no JSX needed here */}

            <TouchableOpacity 
              onPress={() => {
                if (isImporting || isReadingFile) return;
                if (Platform.OS === 'web') {
                  webFileInputRef.current?.click();
                } else {
                  handlePickFileNative();
                }
              }}
              disabled={isImporting || isReadingFile}
              style={[
                styles.button, 
                { backgroundColor: AppTheme.colors.surface, borderWidth: 1, borderColor: AppTheme.colors.primary, marginBottom: AppTheme.spacing.m, flex: 0, padding: 10 },
                (isImporting || isReadingFile) && { opacity: 0.5, borderColor: AppTheme.colors.border }
              ]}
            >
              {isReadingFile ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="small" color={AppTheme.colors.primary} style={{ marginRight: 8 }} />
                  <Text style={{ color: AppTheme.colors.primary, fontWeight: '600' }}>Reading File...</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="folder-open-outline" size={18} color={AppTheme.colors.primary} style={{ marginRight: 6 }} />
                  <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', textAlign: 'center' }}>
                    {pickedFileName ? 'Change OfflineLocker Backup File (.olocker)' : 'Select OfflineLocker Backup File (.olocker)'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <TextInput
              style={[
                styles.input, 
                { letterSpacing: 0 },
                (isImporting || isReadingFile) && { backgroundColor: AppTheme.colors.border, opacity: 0.6 }
              ]}
              placeholder="Backup password (or old 4-digit PIN)"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={importPin}
              onChangeText={setImportPin}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              editable={!isImporting && !isReadingFile}
            />

            {isImporting && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 8, padding: 8, backgroundColor: 'rgba(6, 182, 212, 0.08)', borderRadius: 8 }}>
                <ActivityIndicator size="small" color={AppTheme.colors.primary} style={{ marginRight: 8 }} />
                <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13 }}>
                  Importing & Restoring... Please wait.
                </Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => { 
                  if (isImporting || isReadingFile) return;
                  setImportModalVisible(false); 
                  setImportPin(''); 
                  setPickedFileContent(null); 
                  setPickedFileName(null); 
                }} 
                disabled={isImporting || isReadingFile}
                style={[
                  styles.button, 
                  { backgroundColor: AppTheme.colors.border },
                  (isImporting || isReadingFile) && { opacity: 0.5 }
                ]}
              >
                <Text style={[styles.buttonText, { color: (isImporting || isReadingFile) ? AppTheme.colors.textSecondary : AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isImportDisabled = !pickedFileContent || importPin.length < 4 || isImporting || isReadingFile;
                return (
                  <TouchableOpacity
                    onPress={handlePerformImport}
                    disabled={isImportDisabled}
                    style={[styles.button, isImportDisabled && { backgroundColor: AppTheme.colors.border, opacity: 0.5 }]}
                  >
                    {isImporting ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={[styles.buttonText, isImportDisabled && { color: AppTheme.colors.textSecondary }]}>Decrypt & Restore</Text>
                    )}
                  </TouchableOpacity>
                );
              })()}
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DELETE TAB CONFIRMATION MODAL */}
      <Modal visible={!!deleteConfirmTab} animationType="fade" transparent>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}>
          <View style={{
            backgroundColor: '#ffffff',
            borderRadius: 16,
            padding: 24,
            maxWidth: 380,
            width: '100%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.15,
            shadowRadius: 24,
            elevation: 8,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: '#fee2e2',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 12,
              }}>
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: AppTheme.colors.text, flex: 1 }}>Delete Vault Tab</Text>
              <ModalCloseButton onPress={() => setDeleteConfirmTab(null)} />
            </View>
            <Text style={{ fontSize: 14, color: AppTheme.colors.textSecondary, lineHeight: 20, marginBottom: 20 }}>
              Are you sure you want to delete "{deleteConfirmTab?.name}" and all documents stored inside it? This action cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity
                onPress={() => setDeleteConfirmTab(null)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 20,
                  borderRadius: 8,
                  backgroundColor: '#f1f5f9',
                  marginRight: 10,
                }}
              >
                <Text style={{ color: AppTheme.colors.text, fontWeight: '600', fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDeleteTabAction}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 20,
                  borderRadius: 8,
                  backgroundColor: '#ef4444',
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Sort / Filter Modal */}
      <Modal
        visible={sortModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.sortModalOverlay} 
          activeOpacity={1} 
          onPress={() => setSortModalVisible(false)}
        >
          <View 
            style={styles.sortModalContent}
            onStartShouldSetResponder={() => true}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: AppTheme.colors.primaryLight,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginRight: 10,
                }}>
                  <Ionicons name="filter" size={18} color={AppTheme.colors.primary} />
                </View>
                <View>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: AppTheme.colors.text }}>Sort Categories</Text>
                  <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary }}>Choose display order</Text>
                </View>
              </View>
              <TouchableOpacity 
                onPress={() => setSortModalVisible(false)}
                style={{ padding: 6 }}
                {...(Platform.OS === 'web' ? { title: 'Close' } : {})}
              >
                <Ionicons name="close" size={20} color={AppTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {TAB_SORT_OPTIONS.map((opt) => {
              const isSelected = sortOption === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.sortOptionItem,
                    isSelected && styles.sortOptionItemSelected,
                  ]}
                  onPress={() => {
                    setSortOption(opt.id);
                    setSortModalVisible(false);
                    StorageService.setItem('@offline_locker_tab_sort_option', opt.id);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <View style={[
                      styles.sortOptionIconBox,
                      isSelected && { backgroundColor: AppTheme.colors.primary }
                    ]}>
                      <Ionicons 
                        name={opt.icon} 
                        size={18} 
                        color={isSelected ? '#ffffff' : AppTheme.colors.primary} 
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[
                        styles.sortOptionTitle,
                        isSelected && { color: AppTheme.colors.primary, fontWeight: '700' }
                      ]}>
                        {opt.label}
                      </Text>
                      <Text style={styles.sortOptionDesc}>{opt.desc}</Text>
                    </View>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color={AppTheme.colors.primary} style={{ marginLeft: 8 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

/**
 * Built per accent rather than once at import: StyleSheet.create captures the
 * colours it is given, so a theme change has to rebuild these to take effect.
 */
const createStyles = () => StyleSheet.create({
  container: { flex: 1, backgroundColor: AppTheme.colors.background },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    backgroundColor: AppTheme.colors.surfaceSubtle,
    marginBottom: 10,
  },
  settingsRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppTheme.colors.primaryLight,
    marginRight: 11,
  },
  settingsRowTitle: { fontSize: 14, fontWeight: '700', color: AppTheme.colors.text },
  settingsRowSubtitle: { fontSize: 11.5, color: AppTheme.colors.textSecondary, marginTop: 2 },
  helpHeading: { fontSize: 15, fontWeight: '700', color: AppTheme.colors.text, marginTop: 14, marginBottom: 6 },
  helpBody: { fontSize: 13.5, lineHeight: 20, color: AppTheme.colors.textSecondary, marginBottom: 8 },
  helpBullet: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5 },
  helpBulletDot: { fontSize: 13.5, lineHeight: 20, color: AppTheme.colors.primary, width: 14 },
  helpCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: AppTheme.colors.primaryLight,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  /** Marks the option the app ships with, under its name. */
  defaultTag: { fontSize: 8.5, fontWeight: '600', color: AppTheme.colors.textMuted, marginTop: 1 },
  tabPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: AppTheme.borderRadius.s,
    paddingHorizontal: 13,
    paddingVertical: 13,
  },
  tabPickerText: { flex: 1, fontSize: 14, fontWeight: '600', color: AppTheme.colors.text },
  tabPickerList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: AppTheme.borderRadius.s,
    overflow: 'hidden',
  },
  tabPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  tabPickerItemActive: { backgroundColor: AppTheme.colors.primaryLight },
  tabPickerItemText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: AppTheme.colors.text },
  tabPickerItemTextActive: { color: AppTheme.colors.primary, fontWeight: '700' },
  homeTabBar: {
    flexDirection: 'row',
    backgroundColor: AppTheme.colors.bar,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 8,
  },
  homeTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 9,
    paddingBottom: 7,
    // The active marker sits above the item now that the bar is at the bottom
    borderTopWidth: 2,
    borderTopColor: 'transparent',
  },
  homeTabItemActive: { borderTopColor: AppTheme.colors.primary },
  homeTabLabel: { marginTop: 2, fontSize: 11, fontWeight: '600', color: AppTheme.colors.textSecondary },
  homeTabLabelActive: { color: AppTheme.colors.primary, fontWeight: '800' },
  // Sized to match a note row in the Notes tab
  tabCard: {
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabName: { color: AppTheme.colors.text, fontSize: 13.5, fontWeight: '700' },
  tabDesc: { color: AppTheme.colors.textSecondary, fontSize: 11.5, marginTop: 4 },
  emptyText: { color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40, fontSize: 15 },
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: AppTheme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: AppTheme.colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', justifyContent: 'center', padding: AppTheme.spacing.l },
  modalContent: { maxHeight: '90%', backgroundColor: '#ffffff', padding: AppTheme.spacing.l, borderRadius: AppTheme.borderRadius.xl, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 8 },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: AppTheme.spacing.m },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', color: AppTheme.colors.text, padding: 14, borderRadius: AppTheme.borderRadius.s, marginBottom: AppTheme.spacing.m, fontSize: 15, letterSpacing: 0 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: AppTheme.spacing.m },
  checkboxText: { color: AppTheme.colors.text, marginLeft: 8, fontSize: 15, fontWeight: '500' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: AppTheme.spacing.s },
  button: { flex: 1, backgroundColor: AppTheme.colors.primary, paddingVertical: 14, borderRadius: AppTheme.borderRadius.s, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  editBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', justifyContent: 'center', alignItems: 'center' },
  deleteBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', justifyContent: 'center', alignItems: 'center', marginLeft: 6 },
  sectionHeaderContainer: { marginTop: 8, marginBottom: AppTheme.spacing.l, paddingHorizontal: 4 },
  sectionTitle: { color: AppTheme.colors.text, fontSize: 24, fontWeight: 'bold', letterSpacing: -0.3 },
  sectionSubtitle: { color: AppTheme.colors.textSecondary, fontSize: 15, marginTop: 4 },
  folderIconContainer: { width: 36, height: 36, borderRadius: 10, backgroundColor: AppTheme.colors.iconFolderBg, justifyContent: 'center', alignItems: 'center', marginRight: 10, position: 'relative' },
  lockBadge: { position: 'absolute', bottom: -3, right: -3, backgroundColor: AppTheme.colors.sensitive, borderRadius: 8, padding: 2, borderWidth: 1.5, borderColor: '#ffffff' },
  countBadge: { alignSelf: 'flex-start', backgroundColor: AppTheme.colors.primaryLight, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 10, marginTop: 6 },
  countBadgeText: { color: AppTheme.colors.primary, fontSize: 10, fontWeight: '600' },
  sortFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  sortFilterBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: AppTheme.colors.text,
  },
  sortModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: AppTheme.spacing.l,
  },
  sortModalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    maxWidth: 400,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  sortOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  sortOptionItemSelected: {
    backgroundColor: AppTheme.colors.primaryLight,
    borderColor: AppTheme.colors.primaryBorder,
  },
  sortOptionIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: AppTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sortOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: AppTheme.colors.text,
  },
  sortOptionDesc: {
    fontSize: 12,
    color: AppTheme.colors.textSecondary,
    marginTop: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: AppTheme.colors.text,
    marginBottom: 6,
  },
  inputWithAction: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: AppTheme.borderRadius.s,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: AppTheme.spacing.m,
    minHeight: 50,
  },
  inputDisabled: {
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
  },
  innerInput: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    paddingHorizontal: 0,
  },
  fieldEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    marginLeft: 8,
  },
  fieldEditBtnActive: {
    backgroundColor: AppTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: AppTheme.colors.primaryBorder,
  }
});
