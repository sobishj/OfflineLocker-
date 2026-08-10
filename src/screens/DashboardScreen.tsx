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
  const { tabs, logout, createTab, deleteTab, verifyTabPin, exportBackup, importBackup } = useWalletStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  
  // New tab state
  const [tabName, setTabName] = useState('');
  const [tabDesc, setTabDesc] = useState('');
  const [isSensitive, setIsSensitive] = useState(false);
  const [tabPin, setTabPin] = useState('');

  // Unlock tab state
  const [selectedTab, setSelectedTab] = useState<any>(null);
  const [unlockPin, setUnlockPin] = useState('');

  // Export / Import state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportPin, setExportPin] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importPin, setImportPin] = useState('');
  const [pickedFileContent, setPickedFileContent] = useState<string | null>(null);
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

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

  const handlePickBackupFile = async () => {
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

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setExportModalVisible(true)} style={{ marginRight: 14 }}>
            <Ionicons name="cloud-upload-outline" size={22} color={AppTheme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setImportModalVisible(true)} style={{ marginRight: 14 }}>
            <Ionicons name="cloud-download-outline" size={22} color={AppTheme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} style={{ marginRight: 10 }}>
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
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.tabCard} onPress={() => handleTabPress(item)} onLongPress={() => {
            Alert.alert('Delete', 'Are you sure you want to delete this tab?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteTab(item.uuid) }
            ]);
          }}>
            <View>
              <Text style={styles.tabName}>{item.name}</Text>
              <Text style={styles.tabDesc}>{item.description}</Text>
            </View>
            {item.isSensitive === 1 && (
              <Ionicons name="lock-closed" size={24} color={AppTheme.colors.sensitive} />
            )}
          </TouchableOpacity>
        )}
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

            <TouchableOpacity onPress={handlePickBackupFile} style={[styles.button, { backgroundColor: AppTheme.colors.surface, borderWidth: 1, borderColor: AppTheme.colors.primary, marginBottom: AppTheme.spacing.m, flex: 0, padding: 12 }]}>
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
  buttonText: { color: '#fff', fontWeight: 'bold' }
});
