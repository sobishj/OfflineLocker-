import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, Modal, ActivityIndicator } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

export default function AuthScreen() {
  const { currentUser, registerUser, loginUser, errorMessage, clearError, importBackup } = useWalletStore();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const isRegistration = !currentUser;

  // Import Backup state
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importPin, setImportPin] = useState('');
  const [pickedFileContent, setPickedFileContent] = useState<string | null>(null);
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

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

  const handleSubmit = async () => {
    clearError();
    if (isRegistration) {
      const success = await registerUser(username, pin);
      if (success) {
        Alert.alert('Success', 'Registered successfully. Please login.');
        setPin('');
      }
    } else {
      const success = await loginUser(pin);
      if (!success) {
        setPin('');
      }
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Feather name="lock" size={24} color="#86868b" />
        </View>
        <Text style={styles.title}>{isRegistration ? 'Create Vault' : 'Unlock Vault'}</Text>
        <Text style={styles.subtitle}>
          {isRegistration ? 'Enter a username and 4-digit PIN' : 'Enter your 4-digit PIN to continue'}
        </Text>
        
        {isRegistration && (
          <TextInput
            style={[styles.input, { letterSpacing: 0, textAlign: 'left', fontSize: 16 }]}
            placeholder="Username"
            placeholderTextColor="#8e8e93"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        )}
        
        <TextInput
          style={[styles.input, { letterSpacing: pin ? 8 : 0, textAlign: pin ? 'center' : 'left', fontSize: pin ? 20 : 16 }]}
          placeholder="Enter 4-Digit PIN"
          placeholderTextColor="#8e8e93"
          value={pin}
          onChangeText={setPin}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {(() => {
          const isValid = isRegistration ? (username.trim().length > 0 && pin.trim().length === 4) : (pin.trim().length === 4);
          return (
            <TouchableOpacity 
              style={[styles.button, !isValid && styles.disabledButton]} 
              onPress={handleSubmit}
              disabled={!isValid}
            >
              <Text style={[styles.buttonText, !isValid && styles.disabledButtonText]}>
                {isRegistration ? 'Register' : 'Unlock Vault'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        <TouchableOpacity
          onPress={() => setImportModalVisible(true)}
          style={{ marginTop: 20, alignItems: 'center' }}
        >
          <Text style={{ color: '#007aff', fontWeight: '600', fontSize: 14 }}>
            📥 Import Encrypted Backup (.ewallet)
          </Text>
        </TouchableOpacity>
      </View>

      {/* IMPORT BACKUP MODAL */}
      <Modal visible={importModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Import Encrypted Backup</Text>
            <Text style={{ color: '#86868b', marginBottom: 16, fontSize: 13, textAlign: 'center' }}>
              Select an encrypted backup file (.ewallet) and enter the 4-digit PIN used when exporting.
            </Text>

            <TouchableOpacity onPress={handlePickBackupFile} style={[styles.button, { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#007aff', marginBottom: 16, padding: 12 }]}>
              <Ionicons name="document-text-outline" size={20} color="#007aff" style={{ marginRight: 6 }} />
              <Text style={{ color: '#007aff', fontWeight: '600', textAlign: 'center' }}>
                {pickedFileName ? `Selected: ${pickedFileName}` : 'Choose Backup File (.ewallet)'}
              </Text>
            </TouchableOpacity>

            <TextInput
              style={[styles.input, { letterSpacing: importPin ? 8 : 0, textAlign: importPin ? 'center' : 'left', fontSize: importPin ? 18 : 15 }]}
              placeholder="Enter 4-Digit Export PIN"
              placeholderTextColor="#8e8e93"
              value={importPin}
              onChangeText={setImportPin}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
              <TouchableOpacity onPress={() => { setImportModalVisible(false); setImportPin(''); setPickedFileContent(null); setPickedFileName(null); }} style={[styles.button, { flex: 1, backgroundColor: '#e5e5ea', marginRight: 6 }]}>
                <Text style={[styles.buttonText, { color: '#007aff' }]}>Cancel</Text>
              </TouchableOpacity>

              {(() => {
                const isImportDisabled = !pickedFileContent || importPin.trim().length !== 4 || isImporting;
                return (
                  <TouchableOpacity
                    onPress={handlePerformImport}
                    disabled={isImportDisabled}
                    style={[styles.button, { flex: 1, marginLeft: 6 }, isImportDisabled && styles.disabledButton]}
                  >
                    {isImporting ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={[styles.buttonText, isImportDisabled && styles.disabledButtonText]}>Import & Restore</Text>
                    )}
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eaf0f8', // Soft light blue-ish grey background
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)', // Glassmorphism base
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  title: {
    fontSize: 22,
    color: '#1d1d1f',
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#86868b',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#1d1d1f',
    marginBottom: 16,
    fontSize: 16,
    textAlign: 'left',
    letterSpacing: 0,
  },
  error: {
    color: '#ff3b30',
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#78a3f0', // Soft blue from the image
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#cbd5e1',
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledButtonText: {
    color: '#94a3b8',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: 'rgba(255, 255, 255, 0.95)', padding: 24, borderRadius: 20, borderWidth: 1, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  modalTitle: { color: '#1d1d1f', fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
});
