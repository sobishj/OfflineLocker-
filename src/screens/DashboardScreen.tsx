import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import { useLockerStore } from '../store/useLockerStore';
import { AppTheme } from '../theme/AppTheme';
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
import { CryptoService } from '../services/CryptoService';
import { withoutAutoLock } from '../services/AutoLockService';

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
  const { tabs, tabDocCounts, logout, createTab, updateTab, deleteTab, verifyTabPin, exportBackup, importBackup, currentUser, updateUserProfile } = useLockerStore();
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < 768;
  const insets = useSafeAreaInsets();

  const { defaultHomeTab, loadDefaultHomeTab, setDefaultHomeTab } = useLockerStore();
  const [homeTab, setHomeTab] = useState<HomeTab>('files');
  // Only the first arrival should follow the preference; later tab taps stand
  const appliedDefaultRef = useRef(false);
  const [tabPickerOpen, setTabPickerOpen] = useState(false);
  // Held as a draft so Save Changes commits it, like the other fields here
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

  // Unlock tab state
  const [selectedTab, setSelectedTab] = useState<any>(null);
  const [unlockPin, setUnlockPin] = useState('');
  const [pinActionTarget, setPinActionTarget] = useState<'open' | 'edit' | 'delete'>('open');

  // Export / Import state
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportPin, setExportPin] = useState('');
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

  const openEditTabModal = (tab: any) => {
    setEditTabId(tab.uuid);
    setEditTabName(tab.name);
    setEditTabDesc(tab.description || '');
    setEditIsSensitive(tab.isSensitive === 1);
    setEditTabPin('');
    setEditConfirmTabPin('');
    setEditModalVisible(true);
  };

  const handleOpenEditTab = (tab: any) => {
    if (tab.isSensitive === 1 && tab.tabPinHash) {
      setSelectedTab(tab);
      setPinActionTarget('edit');
      setUnlockPin('');
      setPinModalVisible(true);
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

    if (editIsSensitive && editTabPin.trim()) {
      if (editTabPin.trim().length !== 4 || !/^\d{4}$/.test(editTabPin.trim())) {
        Alert.alert('Invalid PIN', 'Tab PIN must be exactly 4 digits.');
        return;
      }
      if (!editConfirmTabPin.trim()) {
        Alert.alert('Confirm Tab PIN', 'Please re-enter and confirm the new 4-digit Tab PIN.');
        return;
      }
      if (editTabPin.trim() !== editConfirmTabPin.trim()) {
        Alert.alert('PIN Mismatch', 'New Tab PIN and Confirm Tab PIN do not match.');
        return;
      }
    }

    const success = await updateTab(editTabId, editTabName, editTabDesc, editIsSensitive, editTabPin);
    if (success) {
      setEditModalVisible(false);
      setEditTabId('');
      setEditTabName('');
      setEditTabDesc('');
      setEditIsSensitive(false);
      setEditTabPin('');
      setEditConfirmTabPin('');
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
      setSelectedTab(tab);
      setPinActionTarget('delete');
      setUnlockPin('');
      setPinModalVisible(true);
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
    if (exportPin.trim().length !== 4) return;
    setIsExporting(true);
    try {
      await exportBackup(exportPin.trim());
      setExportModalVisible(false);
      setExportPin('');
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
    if (!pickedFileContent || importPin.trim().length !== 4) return;

    isImportingRef.current = true;
    setIsImporting(true);

    setTimeout(async () => {
      try {
        const res = await importBackup(pickedFileContent, importPin.trim());
        setImportModalVisible(false);
        setImportPin('');
        setPickedFileContent(null);
        setPickedFileName(null);
        Alert.alert('Backup Restored', `Successfully restored ${res.tabsCount} tabs and ${res.docsCount} documents!`);
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

    const isTabChanged = accountDefaultTab !== defaultHomeTab;
    const wantsCredentialChange =
      (isEditingUsername && accountUsername.trim() !== (currentUser?.username || '')) || isEditingNewPin;

    // A launch preference is not a credential, so on its own it saves without
    // asking for the current PIN
    if (isTabChanged && !wantsCredentialChange) {
      await setDefaultHomeTab(accountDefaultTab);
      setAccountModalVisible(false);
      showAccountFeedback('Saved', 'Your default tab has been updated.');
      return;
    }

    // 1. Check if user clicked save without entering old pin
    if (!accountCurrentPin.trim()) {
      showAccountFeedback('Current PIN Required', 'Please enter your current PIN to save changes.');
      return;
    }

    if (accountCurrentPin.trim().length !== 4) {
      showAccountFeedback('Invalid Current PIN', 'Current PIN must be exactly 4 digits.');
      return;
    }

    // 2. Check if entered old PIN is incorrect
    if (currentUser && !CryptoService.verifyPin(accountCurrentPin.trim(), currentUser.pinHash)) {
      showAccountFeedback('Incorrect PIN', 'Incorrect current PIN. Please enter your correct 4-digit PIN.');
      return;
    }

    const isUsernameChanged = isEditingUsername && accountUsername.trim() !== (currentUser?.username || '');
    const isPinChanged = isEditingNewPin;

    // 3. Check if any fields were actually changed
    if (!isUsernameChanged && !isPinChanged && !isTabChanged) {
      showAccountFeedback('No Changes', 'Please click Edit on Username or New PIN, or pick a different default tab.');
      return;
    }

    if (isTabChanged) {
      await setDefaultHomeTab(accountDefaultTab);
    }

    if (isEditingUsername && !accountUsername.trim()) {
      showAccountFeedback('Invalid Username', 'Username cannot be empty.');
      return;
    }

    if (isPinChanged) {
      if (!accountNewPin.trim()) {
        showAccountFeedback('Enter New PIN', 'Please enter a 4-digit new PIN.');
        return;
      }
      if (accountNewPin.trim().length !== 4 || !/^\d{4}$/.test(accountNewPin.trim())) {
        showAccountFeedback('Invalid New PIN', 'New PIN must be exactly 4 digits.');
        return;
      }
      if (!accountConfirmNewPin.trim()) {
        showAccountFeedback('Confirm New PIN', 'Please re-enter and confirm your new 4-digit PIN.');
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
      if (tabPin.trim().length !== 4 || !/^\d{4}$/.test(tabPin.trim())) {
        Alert.alert('Invalid PIN', 'Sensitive tabs require a 4-digit PIN.');
        return;
      }
      if (!confirmTabPin.trim()) {
        Alert.alert('Confirm Tab PIN', 'Please confirm your 4-digit Tab PIN.');
        return;
      }
      if (tabPin.trim() !== confirmTabPin.trim()) {
        Alert.alert('PIN Mismatch', 'Tab PIN and Confirm Tab PIN do not match.');
        return;
      }
    }

    const success = await createTab(tabName, tabDesc, isSensitive, tabPin);
    if (success) {
      setModalVisible(false);
      setTabName(''); setTabDesc(''); setIsSensitive(false); setTabPin(''); setConfirmTabPin('');
    } else {
      Alert.alert('Error', 'Failed to create tab. Ensure sensitive tabs have a 4-digit PIN.');
    }
  };

  const isNavigatingRef = useRef(false);

  const handleTabPress = (tab: any) => {
    if (isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    setTimeout(() => { isNavigatingRef.current = false; }, 500);

    if (tab.isSensitive === 1) {
      setSelectedTab(tab);
      setPinActionTarget('open');
      setUnlockPin('');
      setPinModalVisible(true);
    } else {
      navigation.navigate('TabDetail', { tabId: tab.uuid, tabName: tab.name });
    }
  };

  const handleUnlockTab = () => {
    if (selectedTab && verifyTabPin(selectedTab, unlockPin)) {
      const currentSelected = selectedTab;
      const currentTarget = pinActionTarget;
      const pin = unlockPin;
      setPinModalVisible(false);
      setUnlockPin('');

      if (currentTarget === 'edit') {
        openEditTabModal(currentSelected);
      } else if (currentTarget === 'delete') {
        showDeleteTabPrompt(currentSelected);
      } else {
        navigation.navigate('TabDetail', { tabId: currentSelected.uuid, tabName: currentSelected.name, unlockPin: pin });
      }
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
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: AppTheme.colors.primary,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 10,
          }}>
            <Ionicons name="lock-closed" size={18} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: AppTheme.colors.text }}>OfflineLocker</Text>
        </View>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={handleOpenAccountModal}
            style={{ 
              alignItems: 'center', 
              justifyContent: 'center',
              backgroundColor: AppTheme.colors.cardBackground, 
              width: 36,
              height: 36,
              borderRadius: 18, 
              borderWidth: 1, 
              borderColor: AppTheme.colors.border, 
              marginRight: 8 
            }}
            {...(Platform.OS === 'web' ? { title: 'Account Settings' } : {})}
          >
            <Ionicons name="person-circle-outline" size={22} color={AppTheme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => setBackupModalVisible(true)} 
            style={{ 
              alignItems: 'center', 
              justifyContent: 'center',
              backgroundColor: AppTheme.colors.primaryLight, 
              paddingHorizontal: 14, 
              paddingVertical: 7, 
              borderRadius: 20, 
              borderWidth: 1, 
              borderColor: AppTheme.colors.primaryBorder, 
              marginRight: 10 
            }}
            {...(Platform.OS === 'web' ? { title: 'Backup & Restore Vault Data' } : {})}
          >
            <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13 }}>Backup</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={handleSignOut} 
            style={{ padding: 4, marginRight: 6 }}
            {...(Platform.OS === 'web' ? { title: 'Sign Out' } : {})}
          >
            <Ionicons name="power-outline" size={17} color={AppTheme.colors.primary} />
          </TouchableOpacity>
        </View>
      )
    });
  }, [navigation, currentUser]);

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
            <Text style={styles.modalTitle}>New Vault Tab</Text>
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
                  placeholder="4-Digit Tab PIN" 
                  placeholderTextColor={AppTheme.colors.textSecondary} 
                  value={tabPin} 
                  onChangeText={(t) => setTabPin(t.replace(/[^0-9]/g, '').slice(0, 4))} 
                  keyboardType="numeric" 
                  secureTextEntry 
                  maxLength={4} 
                />
                <TextInput 
                  style={[
                    styles.input, 
                    { letterSpacing: confirmTabPin ? 6 : 0 },
                    tabPin.length === 4 && confirmTabPin.length === 4 && tabPin !== confirmTabPin && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
                  ]} 
                  placeholder="Confirm 4-Digit Tab PIN" 
                  placeholderTextColor={AppTheme.colors.textSecondary} 
                  value={confirmTabPin} 
                  onChangeText={(t) => setConfirmTabPin(t.replace(/[^0-9]/g, '').slice(0, 4))} 
                  keyboardType="numeric" 
                  secureTextEntry 
                  maxLength={4} 
                />
                {tabPin.length === 4 && confirmTabPin.length === 4 && tabPin !== confirmTabPin && (
                  <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginTop: -8, marginBottom: 8, fontWeight: '600' }}>
                    Tab PIN and Confirm Tab PIN do not match.
                  </Text>
                )}
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => {
                  setModalVisible(false);
                  setTabName('');
                  setTabDesc('');
                  setIsSensitive(false);
                  setTabPin('');
                  setConfirmTabPin('');
                }} 
                style={[styles.button, { backgroundColor: AppTheme.colors.border }]}
              >
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isCreateDisabled = !tabName.trim() || (isSensitive && (tabPin.trim().length !== 4 || confirmTabPin.trim().length !== 4 || tabPin.trim() !== confirmTabPin.trim()));
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
            <Text style={styles.modalTitle}>Edit Vault Tab</Text>
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
                  placeholder="New 4-Digit Tab PIN (optional to keep current)"
                  placeholderTextColor={AppTheme.colors.textSecondary}
                  value={editTabPin}
                  onChangeText={(t) => setEditTabPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                  keyboardType="numeric"
                  secureTextEntry
                  maxLength={4}
                />
                {editTabPin.length > 0 && (
                  <>
                    <TextInput
                      style={[
                        styles.input, 
                        { letterSpacing: editConfirmTabPin ? 6 : 0 },
                        editTabPin.length === 4 && editConfirmTabPin.length === 4 && editTabPin !== editConfirmTabPin && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
                      ]}
                      placeholder="Confirm New 4-Digit Tab PIN"
                      placeholderTextColor={AppTheme.colors.textSecondary}
                      value={editConfirmTabPin}
                      onChangeText={(t) => setEditConfirmTabPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                      keyboardType="numeric"
                      secureTextEntry
                      maxLength={4}
                    />
                    {editTabPin.length === 4 && editConfirmTabPin.length === 4 && editTabPin !== editConfirmTabPin && (
                      <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginTop: -8, marginBottom: 8, fontWeight: '600' }}>
                        New Tab PIN and Confirm Tab PIN do not match.
                      </Text>
                    )}
                  </>
                )}
              </>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => {
                  setEditModalVisible(false);
                  setEditTabId('');
                  setEditTabName('');
                  setEditTabDesc('');
                  setEditIsSensitive(false);
                  setEditTabPin('');
                  setEditConfirmTabPin('');
                }} 
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
            <Text style={styles.modalTitle}>
              {pinActionTarget === 'edit' 
                ? `Verify PIN to Edit ${selectedTab?.name}` 
                : pinActionTarget === 'delete'
                ? `Verify PIN to Delete ${selectedTab?.name}`
                : `Unlock ${selectedTab?.name}`}
            </Text>
            <TextInput 
              style={[styles.input, { letterSpacing: unlockPin ? 6 : 0 }]} 
              placeholder="4-Digit PIN" 
              placeholderTextColor={AppTheme.colors.textSecondary} 
              value={unlockPin} 
              onChangeText={setUnlockPin} 
              keyboardType="numeric" 
              secureTextEntry 
              maxLength={4} 
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setPinModalVisible(false); setUnlockPin(''); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isUnlockDisabled = unlockPin.trim().length !== 4;
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
                <Text style={styles.modalTitle}>Account Settings</Text>
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

              {/* Which tab the app opens on */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 6 }}>
                <Text style={styles.label}>Default tab on launch</Text>
              </View>
              <TouchableOpacity
                onPress={() => setTabPickerOpen(!tabPickerOpen)}
                style={styles.tabPickerBtn}
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
                          setAccountDefaultTab(option.key);
                          setTabPickerOpen(false);
                          setAccountError(null);
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
                    setAccountNewPin(t.replace(/[^0-9]/g, '').slice(0, 4));
                  }}
                  placeholder="Enter new 4-digit PIN"
                  placeholderTextColor={AppTheme.colors.textSecondary}
                  keyboardType="number-pad"
                  secureTextEntry={!showNewPin}
                  maxLength={4}
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
                      accountNewPin.length === 4 && accountConfirmNewPin.length === 4 && accountNewPin !== accountConfirmNewPin && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
                    ]}
                    value={accountConfirmNewPin}
                    onChangeText={(t) => {
                      setAccountError(null);
                      setAccountConfirmNewPin(t.replace(/[^0-9]/g, '').slice(0, 4));
                    }}
                    placeholder="Re-enter new 4-digit PIN"
                    placeholderTextColor={AppTheme.colors.textSecondary}
                    keyboardType="number-pad"
                    secureTextEntry={!showNewPin}
                    maxLength={4}
                  />
                  {accountNewPin.length === 4 && accountConfirmNewPin.length === 4 && accountNewPin !== accountConfirmNewPin && (
                    <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginTop: -6, marginBottom: 8, fontWeight: '600' }}>
                      New PIN and Confirm New PIN do not match.
                    </Text>
                  )}
                </>
              )}

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
                  setAccountCurrentPin(t.replace(/[^0-9]/g, '').slice(0, 4));
                }}
                placeholder="Enter current 4-digit PIN"
                placeholderTextColor={AppTheme.colors.textSecondary}
                keyboardType="number-pad"
                secureTextEntry={!showCurrentPin}
                maxLength={4}
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
            <Text style={styles.modalTitle}>Export Encrypted Backup</Text>
            <Text style={{ color: AppTheme.colors.textSecondary, marginBottom: AppTheme.spacing.m, fontSize: 13 }}>
              Enter a 4-digit PIN to encrypt your backup. You must enter this exact PIN when restoring your data.
            </Text>
            <TextInput
              style={[styles.input, { letterSpacing: exportPin ? 8 : 0, textAlign: exportPin ? 'center' : 'left', fontSize: exportPin ? 18 : 15 }]}
              placeholder="Enter 4-Digit Export PIN"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={exportPin}
              onChangeText={setExportPin}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setExportModalVisible(false); setExportPin(''); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isExportDisabled = exportPin.trim().length !== 4 || isExporting;
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
            <Text style={styles.modalTitle}>Import Encrypted Backup</Text>
            
            {pickedFileName && (
              <View style={{ backgroundColor: 'rgba(6, 182, 212, 0.1)', padding: 10, borderRadius: 8, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="document-text-outline" size={20} color={AppTheme.colors.primary} style={{ marginRight: 8 }} />
                <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13, flex: 1 }} numberOfLines={1}>
                  File: {pickedFileName}
                </Text>
              </View>
            )}

            <Text style={{ color: AppTheme.colors.textSecondary, marginBottom: AppTheme.spacing.m, fontSize: 13 }}>
              Enter the 4-digit password / PIN that was used to export this backup file.
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
                { letterSpacing: importPin ? 8 : 0, textAlign: importPin ? 'center' : 'left', fontSize: importPin ? 18 : 15 },
                (isImporting || isReadingFile) && { backgroundColor: AppTheme.colors.border, opacity: 0.6 }
              ]}
              placeholder="Enter 4-Digit Export Password"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={importPin}
              onChangeText={setImportPin}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
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
                const isImportDisabled = !pickedFileContent || importPin.trim().length !== 4 || isImporting || isReadingFile;
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
              <Text style={{ fontSize: 18, fontWeight: '700', color: AppTheme.colors.text }}>Delete Vault Tab</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppTheme.colors.background },
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
    backgroundColor: AppTheme.colors.surface,
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
