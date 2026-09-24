import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';
import { BiometricService, BiometricSupport } from '../services/BiometricService';

/**
 * The device's sensor. Unavailable on web and on phones with nothing enrolled.
 * `refresh` reads it again, so a fingerprint enrolled meanwhile shows up.
 */
export const useBiometricSupport = (refresh = false): BiometricSupport | null => {
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  useEffect(() => {
    let alive = true;
    BiometricService.getSupport(refresh).then(s => { if (alive) setSupport(s); });
    return () => { alive = false; };
  }, []);
  return support;
};

interface BiometricToggleProps {
  value: boolean;
  onChange: (enabled: boolean) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

/**
 * The "Enable biometric unlock" checkbox shown next to every PIN a user sets.
 * Ticking it runs the scan once, so it is never switched on for a sensor that
 * does not recognise the person holding the phone. Where the sensor cannot be
 * used it stays on screen, greyed out, saying why. Hidden only on web.
 */
export default function BiometricToggle({ value, onChange, style, disabled: noPin }: BiometricToggleProps) {
  const support = useBiometricSupport(true);
  const [busy, setBusy] = useState(false);
  const disabled = noPin || !support?.available;
  // Without a usable PIN there is nothing to fall back on, so it cannot stay ticked.
  // A sensor that is missing for now only shows unticked; the saved choice is left alone.
  useEffect(() => {
    if (noPin && value) onChange(false);
  }, [noPin, value]);
  if (!support || (!support.available && !support.reason)) return null;

  const toggle = async () => {
    if (busy || disabled) return;
    if (value) {
      onChange(false);
      return;
    }
    setBusy(true);
    try {
      if (await BiometricService.authenticate(`Confirm ${support.label} to enable biometric unlock`)) onChange(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={toggle}
      activeOpacity={0.7}
      disabled={disabled}
      style={[{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, opacity: disabled ? 0.5 : 1 }, style]}
    >
      <Ionicons name={value && support.available ? 'checkbox' : 'square-outline'} size={22} color={AppTheme.colors.primary} />
      <View style={{ marginLeft: 10, flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: AppTheme.colors.text }}>Enable biometric unlock</Text>
        <Text style={{ fontSize: 11.5, color: AppTheme.colors.textSecondary, marginTop: 1 }}>
          {!support.available
            ? support.reason
            : noPin
            ? 'Enter and confirm a PIN first to turn this on.'
            : `Unlock with ${support.label} first; the PIN still works as a fallback.`}
        </Text>
      </View>
      <Ionicons name={support.icon} size={20} color={AppTheme.colors.textSecondary} style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  );
}

interface BiometricUnlockButtonProps {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The way back to the scan after it was cancelled, placed under a PIN box. */
export function BiometricUnlockButton({ onPress, style }: BiometricUnlockButtonProps) {
  const support = useBiometricSupport();
  if (!support?.available) return null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 11,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: AppTheme.colors.primaryBorder,
        backgroundColor: AppTheme.colors.primaryLight,
      }, style]}
    >
      <Ionicons name={support.icon} size={18} color={AppTheme.colors.primary} style={{ marginRight: 8 }} />
      <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.primary }}>Use {support.label}</Text>
    </TouchableOpacity>
  );
}
