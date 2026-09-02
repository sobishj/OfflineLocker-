import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useLockerStore } from '../store/useLockerStore';
import { AppTheme } from '../theme/AppTheme';
import { Feather } from '@expo/vector-icons';

export default function AuthScreen() {
  const { currentUser, registerUser, loginUser, errorMessage, clearError, lockoutState, refreshLockoutState } = useLockerStore();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(!currentUser);
  const [remainingSec, setRemainingSec] = useState(0);

  useEffect(() => {
    setIsRegisterMode(!currentUser);
  }, [currentUser]);

  useEffect(() => {
    let timer: any = null;
    const checkLockout = async () => {
      const state = await refreshLockoutState();
      if (state && state.remainingSeconds > 0) {
        setRemainingSec(state.remainingSeconds);
      } else {
        setRemainingSec(0);
      }
    };

    checkLockout();
    timer = setInterval(checkLockout, 1000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  const isLockedOut = !isRegisterMode && remainingSec > 0;

  const executeRegistration = async () => {
    const success = await registerUser(username, pin);
    if (success) {
      setPin('');
      setUsername('');
    }
  };

  const handleSubmit = async () => {
    if (isLockedOut) return;
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

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    if (mins > 0) {
      return `${mins}m ${s}s`;
    }
    return `${s}s`;
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Feather name={isLockedOut ? "lock" : "lock"} size={26} color={isLockedOut ? "#ef4444" : AppTheme.colors.primary} />
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

        {isLockedOut && (
          <View style={[styles.warningBox, { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444' }]}>
            <Text style={[styles.warningText, { color: '#ef4444', fontWeight: 'bold' }]}>
              🔒 Vault Locked: Please wait {formatTime(remainingSec)} before trying again.
            </Text>
          </View>
        )}

        {!isRegisterMode && lockoutState && lockoutState.failedAttempts > 0 && (
          <View style={[
            styles.warningBox, 
            { 
              backgroundColor: lockoutState.failedAttempts >= 5 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)', 
              borderColor: lockoutState.failedAttempts >= 5 ? '#ef4444' : '#f59e0b',
              marginTop: isLockedOut ? 4 : 10
            }
          ]}>
            <Text style={[
              styles.warningText, 
              { 
                color: lockoutState.failedAttempts >= 5 ? '#dc2626' : '#d97706', 
                fontWeight: lockoutState.failedAttempts >= 5 ? 'bold' : '600' 
              }
            ]}>
              {lockoutState.failedAttempts >= 5 
                ? `🚨 CRITICAL WARNING: ${lockoutState.failedAttempts}/6 failed PIN attempts! 1 attempt remaining before PERMANENT DATA WIPE & APP RESET!`
                : lockoutState.failedAttempts >= 3
                ? `⚠️ Security Warning: ${lockoutState.failedAttempts}/6 failed PIN attempts. Next failed attempt will trigger 5-minute lockout!`
                : `⚠️ Security Warning: ${lockoutState.failedAttempts}/6 failed PIN attempts.`}
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
          style={[
            styles.input, 
            { letterSpacing: pin ? 8 : 0, textAlign: pin ? 'center' : 'left', fontSize: pin ? 20 : 16 },
            isLockedOut && { opacity: 0.5, backgroundColor: 'rgba(0,0,0,0.05)' }
          ]}
          placeholder={isLockedOut ? `Locked (${formatTime(remainingSec)})` : "Enter 4-Digit PIN"}
          placeholderTextColor="#8e8e93"
          value={pin}
          onChangeText={setPin}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
          editable={!isLockedOut}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {(() => {
          const isValid = !isLockedOut && (isRegisterMode ? (username.trim().length > 0 && pin.trim().length === 4) : (pin.trim().length === 4));
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
    backgroundColor: AppTheme.colors.background,
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    backgroundColor: '#ffffff',
    padding: 36,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 4,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: AppTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    color: AppTheme.colors.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: AppTheme.colors.textSecondary,
    marginBottom: 24,
    textAlign: 'center',
  },
  warningBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  warningText: {
    color: '#dc2626',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: AppTheme.colors.text,
    marginBottom: 16,
    fontSize: 16,
    textAlign: 'left',
    letterSpacing: 0,
  },
  error: {
    color: AppTheme.colors.error,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: AppTheme.colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  disabledButton: {
    backgroundColor: '#e2e8f0',
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
    color: AppTheme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: '#ffffff', padding: 24, borderRadius: 20, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 5 },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
});

