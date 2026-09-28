import React from 'react';
import { View, Text, TouchableOpacity, GestureResponderHandlers, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';

interface Props {
  /** From useDragReorder's handlersFor: holding the grip and moving drags the row. */
  dragHandlers: GestureResponderHandlers;
  compact?: boolean;
  label?: string;
}

/**
 * The grip a row shows while its list is being rearranged. Holding it and
 * moving up or down drags the row to wherever it belongs.
 */
export default function ReorderControls({ dragHandlers, compact, label }: Props) {
  return (
    <View
      {...dragHandlers}
      style={{
        alignSelf: 'stretch',
        justifyContent: 'center',
        paddingHorizontal: compact ? 3 : 6,
        marginRight: compact ? 4 : 8,
        ...(Platform.OS === 'web' ? { cursor: 'grab' } as any : {}),
      }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={label ? `Drag to reorder ${label}` : 'Drag to reorder'}
      {...(Platform.OS === 'web' ? { title: 'Drag to reorder' } : {})}
    >
      <Ionicons name="reorder-three" size={compact ? 20 : 24} color={AppTheme.colors.textSecondary} />
    </View>
  );
}

/**
 * Sits above a list while it is being rearranged, in place of its search and
 * sort controls. Done puts the list back to how it normally looks, in the
 * order it was left in.
 */
export function ArrangeDoneBar({ onDone, compact }: { onDone: () => void; compact?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: AppTheme.colors.primaryLight,
        borderWidth: 1,
        borderColor: AppTheme.colors.primaryBorder,
        borderRadius: 10,
        paddingVertical: compact ? 5 : 7,
        paddingLeft: compact ? 8 : 12,
        paddingRight: compact ? 5 : 7,
      }}
    >
      <Ionicons name="reorder-three" size={compact ? 16 : 18} color={AppTheme.colors.primary} />
      <Text
        style={{ flex: 1, marginLeft: compact ? 4 : 6, marginRight: 6, fontSize: compact ? 10.5 : 12.5, fontWeight: '600', color: AppTheme.colors.primary }}
        numberOfLines={2}
      >
        {compact ? 'Drag to reorder' : 'Drag the handles to reorder'}
      </Text>
      <TouchableOpacity
        onPress={onDone}
        style={{
          backgroundColor: AppTheme.colors.primary,
          borderRadius: 8,
          paddingHorizontal: compact ? 10 : 16,
          paddingVertical: compact ? 5 : 7,
        }}
        accessibilityLabel="Done rearranging"
      >
        <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: compact ? 11 : 13 }}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}
