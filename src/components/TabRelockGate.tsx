import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, AppState, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLockerStore, NEW_PIN_LENGTH } from '../store/useLockerStore';
import { Tab } from '../models';
import { AppTheme } from '../theme/AppTheme';
import { BiometricService, BiometricScopes } from '../services/BiometricService';
import { VaultCrypto } from '../services/VaultCrypto';
import { BiometricUnlockButton } from './BiometricToggle';

interface TabRelockGateProps {
  tab: Tab;
  /** Gives up on the tab and goes back to the list. */
  onLeave: () => void;
}

/**
 * Asks for a sensitive tab's PIN again once the app itself has been unlocked.
 * It covers the tab rather than leaving it, so the file that was open is still
 * open behind it.
 */
export default function TabRelockGate({ tab, onLeave }: TabRelockGateProps) {
  const insets = useSafeAreaInsets();
  const { currentUser, verifyTabPin, clearTabRelock } = useLockerStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [biometricOn, setBiometricOn] = useState(false);
  const promptedRef = useRef(false);
  const pinLength = VaultCrypto.pinLength(tab.tabPinHash);

  const tryBiometric = useCallback(async () => {
    const scope = BiometricScopes.tab(tab.uuid);
    const saved = await BiometricService.unlock(currentUser?.uuid, scope, `Verify to unlock ${tab.name}`);
    if (!saved) return;
    // One saved before the tab's PIN changed must not open it
    if (!verifyTabPin(tab, saved)) {
      await BiometricService.disable(currentUser?.uuid, scope);
      return;
    }
    clearTabRelock();
  }, [clearTabRelock, currentUser?.uuid, tab, verifyTabPin]);

  // A scan first, once the app is in front - the system will not show it before
  useEffect(() => {
    let alive = true;
    BiometricService.isEnabled(currentUser?.uuid, BiometricScopes.tab(tab.uuid)).then(on => {
      if (!alive) return;
      setBiometricOn(on);
      if (!on || promptedRef.current) return;
      const fire = () => {
        if (promptedRef.current) return;
        promptedRef.current = true;
        tryBiometric();
      };
      if (AppState.currentState === 'active') fire();
      else {
        const sub = AppState.addEventListener('change', next => {
          if (next === 'active') {
            sub.remove();
            fire();
          }
        });
      }
    });
    return () => { alive = false; };
  }, [currentUser?.uuid, tab.uuid, tryBiometric]);

  const submit = () => {
    if (verifyTabPin(tab, pin)) {
      setPin('');
      clearTabRelock();
    } else {
      setError('Incorrect PIN. Please try again.');
      setPin('');
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[StyleSheet.absoluteFill, styles.overlay, { paddingTop: insets.top + 24 }]}
    >
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={26} color="#f59e0b" />
        </View>
        <Text style={styles.title} numberOfLines={2}>Unlock {tab.name}</Text>
        <Text style={styles.subtitle}>Enter this tab's PIN to carry on where you left off.</Text>

        <TextInput
          style={[styles.input, { borderColor: error ? AppTheme.colors.error : '#e2e8f0', letterSpacing: pin ? 6 : 0 }]}
          placeholder={`${pinLength}-Digit PIN`}
          placeholderTextColor={AppTheme.colors.textSecondary}
          value={pin}
          onChangeText={t => {
            setPin(t.replace(/[^0-9]/g, '').slice(0, pinLength));
            setError('');
          }}
          keyboardType="numeric"
          secureTextEntry
          maxLength={NEW_PIN_LENGTH}
          autoFocus={!biometricOn}
        />
        {!!error && <Text style={styles.error}>{error}</Text>}

        {biometricOn && <BiometricUnlockButton onPress={tryBiometric} style={{ marginBottom: 12 }} />}

        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={onLeave} style={[styles.button, styles.secondary]}>
            <Text style={[styles.secondaryText, { color: AppTheme.colors.primary }]}>Back to tabs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={submit}
            disabled={pin.length !== pinLength}
            style={[styles.button, { backgroundColor: pin.length === pinLength ? AppTheme.colors.primary : AppTheme.colors.border }]}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: pin.length === pinLength ? '#ffffff' : AppTheme.colors.textSecondary }}>
              Unlock
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: AppTheme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    zIndex: 100,
    elevation: 100,
  },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#ffffff', borderRadius: 18, padding: 20 },
  iconWrap: {
    alignSelf: 'center',
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(245,158,11,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, textAlign: 'center' },
  subtitle: { fontSize: 12, color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderRadius: 10,
    padding: 13,
    fontSize: 14,
    color: AppTheme.colors.text,
    marginBottom: 12,
  },
  error: { color: AppTheme.colors.error, fontSize: 12, fontWeight: '600', marginBottom: 12, marginTop: -4 },
  button: { flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  secondary: { backgroundColor: AppTheme.colors.border, marginRight: 8 },
  // Its colour is set where it is drawn, so a change of accent reaches it
  secondaryText: { fontSize: 14, fontWeight: '700' },
});
