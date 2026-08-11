import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { Feather } from '@expo/vector-icons';

export default function AuthScreen() {
  const { currentUser, registerUser, loginUser, errorMessage, clearError } = useWalletStore();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(!currentUser);

  useEffect(() => {
    setIsRegisterMode(!currentUser);
  }, [currentUser]);

  const executeRegistration = async () => {
    const success = await registerUser(username, pin);
    if (success) {
      setPin('');
      setUsername('');
    }
  };

  const handleSubmit = async () => {
    clearError();
    if (isRegisterMode) {
      if (currentUser) {
        const confirmMsg = `Creating a new user will permanently delete the previous account (${currentUser.username}) and all saved vault documents. Continue?`;
        if (Platform.OS === 'web') {
          if (window.confirm(confirmMsg)) {
            await executeRegistration();
          }
        } else {
          Alert.alert(
            'Create New User',
            confirmMsg,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete & Create', style: 'destructive', onPress: executeRegistration }
            ]
          );
        }
      } else {
        await executeRegistration();
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
        
        <Text style={styles.title}>{isRegisterMode ? 'Create Vault' : 'Unlock Vault'}</Text>
        <Text style={styles.subtitle}>
          {isRegisterMode 
            ? 'Enter a username and 4-digit PIN for the new account' 
            : `Welcome back, ${currentUser?.username || 'User'}! Enter your 4-digit PIN`}
        </Text>
        
        {isRegisterMode && currentUser && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              ⚠️ Registering a new user will permanently delete existing vault data for "{currentUser.username}".
            </Text>
          </View>
        )}

        {isRegisterMode && (
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
          const isValid = isRegisterMode ? (username.trim().length > 0 && pin.trim().length === 4) : (pin.trim().length === 4);
          return (
            <TouchableOpacity 
              style={[styles.button, !isValid && styles.disabledButton]} 
              onPress={handleSubmit}
              disabled={!isValid}
            >
              <Text style={[styles.buttonText, !isValid && styles.disabledButtonText]}>
                {isRegisterMode ? 'Register & Create Vault' : 'Unlock Vault'}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {currentUser && (
          <TouchableOpacity 
            style={styles.toggleButton} 
            onPress={() => {
              clearError();
              setPin('');
              setIsRegisterMode(!isRegisterMode);
            }}
          >
            <Text style={styles.toggleText}>
              {isRegisterMode ? `← Back to Login (${currentUser.username})` : '+ Register New User / Reset Vault'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
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
    marginBottom: 20,
    textAlign: 'center',
  },
  warningBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
    width: '100%',
  },
  warningText: {
    color: '#dc2626',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
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
  toggleButton: {
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  toggleText: {
    color: '#0284c7',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: 'rgba(255, 255, 255, 0.95)', padding: 24, borderRadius: 20, borderWidth: 1, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  modalTitle: { color: '#1d1d1f', fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
});

