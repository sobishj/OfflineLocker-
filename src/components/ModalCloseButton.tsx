import React from 'react';
import { TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';

/**
 * The dismiss control every pop-up carries, in the corner of its title row.
 *
 * App settings set the shape - a plain circled cross, no background - and the
 * rest of the app follows it so that closing a window is the same gesture
 * wherever you are. The tap target is padded out beyond the glyph, which is
 * smaller than a fingertip.
 */
export default function ModalCloseButton({
  onPress,
  style,
  label = 'Close',
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={[{ paddingLeft: 10 }, style]}
    >
      <Ionicons name="close-circle-outline" size={24} color={AppTheme.colors.textSecondary} />
    </TouchableOpacity>
  );
}
