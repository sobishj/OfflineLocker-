import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { AppTheme } from '../theme/AppTheme';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

type DashboardProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function DashboardScreen({ navigation }: DashboardProps) {
  const { tabs, tabDocCounts, logout, createTab, updateTab, deleteTab, verifyTabPin, exportBackup, importBackup } = useWalletStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  
  // New tab state
  const [tabName, setTabName] = useState('');
  const [tabDesc, setTabDesc] = useState('');
  const [isSensitive, setIsSensitive] = useState(false);
  const [tabPin, setTabPin] = useState('');

  // Edit tab state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTabId, setEditTabId] = useState('');
  const [editTabName, setEditTabName] = useState('');
  const [editTabDesc, setEditTabDesc] = useState('');

  // Unlock tab state
  const [selectedTab, setSelectedTab] = useState<any>(null);
  const [unlockPin, setUnlockPin] = useState('');

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

  const handleOpenEditTab = (tab: any) => {
    setEditTabId(tab.uuid);
    setEditTabName(tab.name);
    setEditTabDesc(tab.description || '');
    setEditModalVisible(true);
  };

  const handleSaveEditTab = async () => {
    if (!editTabName.trim()) return;
    const success = await updateTab(editTabId, editTabName, editTabDesc);
    if (success) {
      setEditModalVisible(false);
      setEditTabId('');
      setEditTabName('');
      setEditTabDesc('');
    } else {
      Alert.alert('Error', 'Failed to update tab details.');
    }
  };

  const handleConfirmDeleteTab = (tab: any) => {
    const doDelete = () => deleteTab(tab.uuid);
    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to delete tab "${tab.name}" and all its documents?`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Delete Vault Tab',
        `Are you sure you want to delete "${tab.name}" and all documents stored inside it?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete }
        ]
      );
    }
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

  const handlePickAndOpenImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setPickedFileName(asset.name);
        if (Platform.OS === 'web') {
          const reader = new FileReader();
          const contentPromise = new Promise<string>((resolve) => {
            reader.onload = (e) => resolve(e.target?.result as string);
          });
          reader.readAsText(asset.file as any);
          const text = await contentPromise;
          setPickedFileContent(text);
        } else {
          const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
          setPickedFileContent(text);
        }
        setImportModalVisible(true);
      }
    } catch (err: any) {
      Alert.alert('Error', 'Failed to read backup file.');
    }
  };

  const handlePerformImport = async () => {
    if (!pickedFileContent || importPin.trim().length !== 4) return;
    setIsImporting(true);
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
      setIsImporting(false);
    }
  };

  const handleCreateTab = async () => {
    const success = await createTab(tabName, tabDesc, isSensitive, tabPin);
    if (success) {
      setModalVisible(false);
      setTabName(''); setTabDesc(''); setIsSensitive(false); setTabPin('');
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
      setPinModalVisible(true);
    } else {
      navigation.navigate('TabDetail', { tabId: tab.uuid, tabName: tab.name });
    }
  };

  const handleUnlockTab = () => {
    if (selectedTab && verifyTabPin(selectedTab, unlockPin)) {
      setPinModalVisible(false);
      setUnlockPin('');
      navigation.navigate('TabDetail', { tabId: selectedTab.uuid, tabName: selectedTab.name, unlockPin });
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
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={() => setBackupModalVisible(true)} 
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0, 122, 255, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginRight: 14 }}
          >
            <Ionicons name="cloud-outline" size={18} color={AppTheme.colors.primary} style={{ marginRight: 4 }} />
            <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13 }}>Backup</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut} style={{ marginRight: 10 }}>
            <Ionicons name="log-out-outline" size={22} color={AppTheme.colors.primary} />
          </TouchableOpacity>
        </View>
      )
    });
  }, [navigation]);

  return (
    <View style={styles.container}>
      <FlatList
        data={tabs}
        keyExtractor={item => item.uuid}
        contentContainerStyle={{ padding: AppTheme.spacing.m }}
        ListHeaderComponent={
          <View style={styles.sectionHeaderContainer}>
            <Text style={styles.sectionTitle}>Your document categories</Text>
            <Text style={styles.sectionSubtitle}>Organize and protect what matters.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const docCount = tabDocCounts[item.uuid] || 0;
          return (
            <TouchableOpacity style={styles.tabCard} onPress={() => handleTabPress(item)}>
              {/* Category Folder Icon Badge */}
              <View style={styles.folderIconContainer}>
                <Ionicons 
                  name="folder-open" 
                  size={26} 
                  color={AppTheme.colors.primary} 
                />
                {item.isSensitive === 1 && (
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={10} color="#fff" />
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
                  style={styles.cardActionBtn}
                >
                  <Ionicons name="pencil" size={14} color={AppTheme.colors.primary} />
                  <Text style={styles.cardActionText}>Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  onPress={(e) => {
                    if (e && e.stopPropagation) e.stopPropagation();
                    handleConfirmDeleteTab(item);
                  }} 
                  style={[styles.cardActionBtn, { marginLeft: 6, backgroundColor: 'rgba(239, 68, 68, 0.08)' }]}
                >
                  <Ionicons name="trash" size={14} color={AppTheme.colors.error} />
                </TouchableOpacity>

                <Ionicons name="chevron-forward" size={18} color={AppTheme.colors.textSecondary} style={{ marginLeft: 6 }} />
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<Text style={styles.emptyText}>No tabs available. Create one below.</Text>}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Ionicons name="add" size={32} color={AppTheme.colors.background} />
      </TouchableOpacity>

      {/* CREATE TAB MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
            <Text style={styles.modalTitle}>New Vault Tab</Text>
            <TextInput style={[styles.input, { letterSpacing: 0 }]} placeholder="Tab Name" placeholderTextColor={AppTheme.colors.textSecondary} value={tabName} onChangeText={setTabName} />
            <TextInput style={[styles.input, { letterSpacing: 0 }]} placeholder="Description" placeholderTextColor={AppTheme.colors.textSecondary} value={tabDesc} onChangeText={setTabDesc} />
            
            <TouchableOpacity style={styles.checkboxRow} onPress={() => setIsSensitive(!isSensitive)}>
              <Ionicons name={isSensitive ? "checkbox" : "square-outline"} size={24} color={AppTheme.colors.primary} />
              <Text style={styles.checkboxText}>Sensitive Tab (Requires PIN)</Text>
            </TouchableOpacity>

            {isSensitive && (
              <TextInput style={[styles.input, { letterSpacing: tabPin ? 6 : 0 }]} placeholder="4-Digit Tab PIN" placeholderTextColor={AppTheme.colors.textSecondary} value={tabPin} onChangeText={setTabPin} keyboardType="numeric" secureTextEntry maxLength={4} />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => {
                  setModalVisible(false);
                  setTabName('');
                  setTabDesc('');
                  setIsSensitive(false);
                  setTabPin('');
                }} 
                style={[styles.button, { backgroundColor: AppTheme.colors.border }]}
              >
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isCreateDisabled = !tabName.trim() || (isSensitive && tabPin.trim().length !== 4);
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT TAB MODAL */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
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

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => {
                  setEditModalVisible(false);
                  setEditTabId('');
                  setEditTabName('');
                  setEditTabDesc('');
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* UNLOCK TAB MODAL */}
      <Modal visible={pinModalVisible} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
            <Text style={styles.modalTitle}>Unlock {selectedTab?.name}</Text>
            <TextInput style={[styles.input, { letterSpacing: unlockPin ? 6 : 0 }]} placeholder="4-Digit PIN" placeholderTextColor={AppTheme.colors.textSecondary} value={unlockPin} onChangeText={setUnlockPin} keyboardType="numeric" secureTextEntry maxLength={4} />
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
                    <Text style={[styles.buttonText, isUnlockDisabled && { color: AppTheme.colors.textSecondary }]}>Unlock</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* UNIFIED BACKUP MENU MODAL */}
      <Modal visible={backupModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
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
                setBackupModalVisible(false);
                handlePickAndOpenImport();
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
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EXPORT BACKUP MODAL */}
      <Modal visible={exportModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
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
                      <Text style={[styles.buttonText, isExportDisabled && { color: AppTheme.colors.textSecondary }]}>Export & Share</Text>
                    )}
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* IMPORT BACKUP MODAL */}
      <Modal visible={importModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
            <Text style={styles.modalTitle}>Import Encrypted Backup</Text>
            <Text style={{ color: AppTheme.colors.textSecondary, marginBottom: AppTheme.spacing.m, fontSize: 13 }}>
              Select an encrypted backup file (.ewallet) and enter the 4-digit PIN used when exporting.
            </Text>

            <TouchableOpacity onPress={handlePickAndOpenImport} style={[styles.button, { backgroundColor: AppTheme.colors.surface, borderWidth: 1, borderColor: AppTheme.colors.primary, marginBottom: AppTheme.spacing.m, flex: 0, padding: 12 }]}>
              <Ionicons name="document-text-outline" size={20} color={AppTheme.colors.primary} style={{ marginRight: 6 }} />
              <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', textAlign: 'center' }}>
                {pickedFileName ? `Selected: ${pickedFileName}` : 'Choose Backup File (.ewallet)'}
              </Text>
            </TouchableOpacity>

            <TextInput
              style={[styles.input, { letterSpacing: importPin ? 8 : 0, textAlign: importPin ? 'center' : 'left', fontSize: importPin ? 18 : 15 }]}
              placeholder="Enter 4-Digit Export PIN"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={importPin}
              onChangeText={setImportPin}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setImportModalVisible(false); setImportPin(''); setPickedFileContent(null); setPickedFileName(null); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              {(() => {
                const isImportDisabled = !pickedFileContent || importPin.trim().length !== 4 || isImporting;
                return (
                  <TouchableOpacity
                    onPress={handlePerformImport}
                    disabled={isImportDisabled}
                    style={[styles.button, isImportDisabled && { backgroundColor: AppTheme.colors.border, opacity: 0.5 }]}
                  >
                    {isImporting ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={[styles.buttonText, isImportDisabled && { color: AppTheme.colors.textSecondary }]}>Import & Restore</Text>
                    )}
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppTheme.colors.background },
  tabCard: { backgroundColor: AppTheme.colors.surface, padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.m, marginBottom: AppTheme.spacing.m, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: AppTheme.colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  tabName: { color: AppTheme.colors.text, fontSize: 18, fontWeight: 'bold' },
  tabDesc: { color: AppTheme.colors.textSecondary, fontSize: 14, marginTop: 4 },
  emptyText: { color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40 },
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: AppTheme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: AppTheme.colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: AppTheme.spacing.l },
  modalContent: { backgroundColor: 'rgba(255, 255, 255, 0.8)', padding: AppTheme.spacing.l, borderRadius: AppTheme.borderRadius.l, borderWidth: 1, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: AppTheme.spacing.m },
  input: { backgroundColor: 'rgba(255, 255, 255, 0.6)', borderWidth: 1, borderColor: '#fff', color: AppTheme.colors.text, padding: 12, borderRadius: AppTheme.borderRadius.s, marginBottom: AppTheme.spacing.m, fontSize: 15, letterSpacing: 0 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: AppTheme.spacing.m },
  checkboxText: { color: AppTheme.colors.text, marginLeft: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: AppTheme.spacing.s },
  button: { flex: 1, backgroundColor: AppTheme.colors.primary, padding: 12, borderRadius: AppTheme.borderRadius.s, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  cardActionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(6, 182, 212, 0.08)', borderRadius: 6 },
  cardActionText: { color: AppTheme.colors.primary, fontSize: 12, marginLeft: 6, fontWeight: '600' },
  sectionHeaderContainer: { marginBottom: AppTheme.spacing.m, paddingHorizontal: 4 },
  sectionTitle: { color: AppTheme.colors.text, fontSize: 16, fontWeight: 'bold' },
  sectionSubtitle: { color: AppTheme.colors.textSecondary, fontSize: 13, marginTop: 2 },
  folderIconContainer: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(6, 182, 212, 0.12)', justifyContent: 'center', alignItems: 'center', marginRight: 12, position: 'relative' },
  lockBadge: { position: 'absolute', bottom: -2, right: -2, backgroundColor: AppTheme.colors.sensitive, borderRadius: 8, padding: 3 },
  countBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(6, 182, 212, 0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, marginTop: 6 },
  countBadgeText: { color: AppTheme.colors.primary, fontSize: 11, fontWeight: '700' }
});
