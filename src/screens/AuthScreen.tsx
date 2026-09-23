import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, AppState } from 'react-native';
import { useLockerStore, NEW_PIN_LENGTH } from '../store/useLockerStore';
import { AppTheme } from '../theme/AppTheme';
import { Feather } from '@expo/vector-icons';
import BiometricToggle, { BiometricUnlockButton } from '../components/BiometricToggle';
import { BiometricService, BiometricScopes } from '../services/BiometricService';
import { VaultCrypto } from '../services/VaultCrypto';

export default function AuthScreen() {
  const { currentUser, registerUser, loginUser, unlockWithBiometric, errorMessage, clearError, lockoutState, refreshLockoutState, themeVersion } = useLockerStore();
  const styles = useMemo(() => createStyles(), [themeVersion]);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(!currentUser);
  const [remainingSec, setRemainingSec] = useState(0);
  const [registerBiometric, setRegisterBiometric] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  // One automatic prompt per visit to this screen; after that it waits for the button
  const autoPromptedRef = useRef(false);
  const promptingRef = useRef(false);

  useEffect(() => {
    setIsRegisterMode(!currentUser);
  }, [currentUser]);

  useEffect(() => {
    let alive = true;
    BiometricService.isEnabled(currentUser?.uuid, BiometricScopes.app).then(on => { if (alive) setBiometricEnabled(on); });
    return () => { alive = false; };
  }, [currentUser?.uuid]);

  const tryBiometric = useCallback(async () => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    try {
      const ok = await unlockWithBiometric();
      if (ok) setPin('');
    } finally {
      promptingRef.current = false;
    }
  }, [unlockWithBiometric]);

  // Biometrics first. The screen is usually mounted by the auto-lock while the
  // app is in the background, where the system refuses to show the prompt, so
  // it waits until the app is back in front.
  useEffect(() => {
    if (isRegisterMode || !biometricEnabled || autoPromptedRef.current) return;
    const fire = () => {
      if (autoPromptedRef.current) return;
      autoPromptedRef.current = true;
      tryBiometric();
    };
    if (AppState.currentState === 'active') {
      fire();
      return;
    }
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        sub.remove();
        fire();
      }
    });
    return () => sub.remove();
  }, [isRegisterMode, biometricEnabled, tryBiometric]);

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
  // A new vault gets a 6-digit PIN; an existing one may still have its 4-digit PIN
  const pinLen = isRegisterMode ? NEW_PIN_LENGTH : VaultCrypto.pinLength(currentUser?.pinHash);

  const executeRegistration = async () => {
    if (pin.trim() !== confirmPin.trim()) return;
    const success = await registerUser(username, pin, registerBiometric);
    if (success) {
      setPin('');
      setConfirmPin('');
      setUsername('');
      setRegisterBiometric(false);
    }
  };

  const handleSubmit = async () => {
    if (isLockedOut) return;
    clearError();
    if (isRegisterMode) {
      if (pin.trim() !== confirmPin.trim()) return;
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
            ? `Enter a username and set a ${pinLen}-digit PIN for the new vault`
            : `Welcome back, ${currentUser?.username || 'User'}! Enter your ${pinLen}-digit PIN`}
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
            onChangeText={(t) => {
              clearError();
              setUsername(t);
            }}
            autoCapitalize="none"
          />
        )}
        
        <TextInput
          style={[
            styles.input, 
            { letterSpacing: pin ? 8 : 0, textAlign: pin ? 'center' : 'left', fontSize: pin ? 20 : 16 },
            isLockedOut && { opacity: 0.5, backgroundColor: 'rgba(0,0,0,0.05)' }
          ]}
          placeholder={isLockedOut ? `Locked (${formatTime(remainingSec)})` : (isRegisterMode ? `Create ${pinLen}-Digit PIN` : `Enter ${pinLen}-Digit PIN`)}
          placeholderTextColor="#8e8e93"
          value={pin}
          onChangeText={(t) => {
            clearError();
            setPin(t.replace(/[^0-9]/g, '').slice(0, pinLen));
          }}
          keyboardType="numeric"
          secureTextEntry
          maxLength={pinLen}
          editable={!isLockedOut}
        />

        {isRegisterMode && (
          <TextInput
            style={[
              styles.input, 
              { letterSpacing: confirmPin ? 8 : 0, textAlign: confirmPin ? 'center' : 'left', fontSize: confirmPin ? 20 : 16 },
              confirmPin.length === pinLen && pin.length === pinLen && confirmPin !== pin && { borderColor: AppTheme.colors.error, borderWidth: 1.5 }
            ]}
            placeholder={`Confirm ${pinLen}-Digit PIN`}
            placeholderTextColor="#8e8e93"
            value={confirmPin}
            onChangeText={(t) => {
              clearError();
              setConfirmPin(t.replace(/[^0-9]/g, '').slice(0, pinLen));
            }}
            keyboardType="numeric"
            secureTextEntry
            maxLength={pinLen}
          />
        )}

        {isRegisterMode && pin.length === pinLen && confirmPin.length === pinLen && pin !== confirmPin && (
          <Text style={[styles.error, { marginTop: -8, marginBottom: 12 }]}>
            PINs do not match. Please re-enter.
          </Text>
        )}

        {isRegisterMode && (
          <BiometricToggle value={registerBiometric} onChange={setRegisterBiometric} style={{ alignSelf: 'stretch', marginBottom: 16 }} />
        )}

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {(() => {
          const isValid = !isLockedOut && (
            isRegisterMode 
              ? (username.trim().length > 0 && pin.trim().length === pinLen && confirmPin.trim().length === pinLen && pin.trim() === confirmPin.trim()) 
              : (pin.trim().length === pinLen)
          );
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

        {!isRegisterMode && biometricEnabled && !isLockedOut && (
          <BiometricUnlockButton onPress={tryBiometric} style={{ alignSelf: 'stretch', marginTop: 12, height: 52 }} />
        )}

        {currentUser && (
          <TouchableOpacity 
            style={styles.toggleButton} 
            onPress={() => {
              clearError();
              setPin('');
              setConfirmPin('');
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

/**
 * Built per accent rather than once at import: StyleSheet.create captures the
 * colours it is given, so a theme change has to rebuild these to take effect.
 */
const createStyles = () => StyleSheet.create({
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

