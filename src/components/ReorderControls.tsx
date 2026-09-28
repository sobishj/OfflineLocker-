import React from 'react';
import { View, TouchableOpacity, GestureResponderHandlers, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';

interface Props {
  /** From useDragReorder's handlersFor: holding the grip and moving drags the row. */
  dragHandlers: GestureResponderHandlers;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  compact?: boolean;
  label?: string;
}

/**
 * The controls a row shows while its list is in custom order: an arrow each
 * way for a precise one-place move, and a grip between them to drag the row
 * to wherever it belongs.
 */
export default function ReorderControls({ dragHandlers, onMoveUp, onMoveDown, canMoveUp, canMoveDown, compact, label }: Props) {
  const arrow = compact ? 14 : 17;
  const pad = compact ? 1 : 3;
  const tip = (text: string) => (Platform.OS === 'web' ? { title: text } : {});
  const stop = (fn: () => void) => (e: any) => {
    if (e && e.stopPropagation) e.stopPropagation();
    fn();
  };

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', marginRight: compact ? 4 : 8 }}>
      <TouchableOpacity
        onPress={stop(onMoveUp)}
        disabled={!canMoveUp}
        style={{ padding: pad, opacity: canMoveUp ? 1 : 0.25 }}
        hitSlop={{ top: 4, bottom: 2, left: 6, right: 6 }}
        accessibilityLabel={label ? `Move ${label} up` : 'Move up'}
        {...tip('Move up')}
      >
        <Ionicons name="chevron-up" size={arrow} color={AppTheme.colors.primary} />
      </TouchableOpacity>
      <View
        {...dragHandlers}
        style={{ paddingVertical: compact ? 1 : 2, paddingHorizontal: compact ? 3 : 5, ...(Platform.OS === 'web' ? { cursor: 'grab' } as any : {}) }}
        hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
        accessibilityLabel={label ? `Drag to reorder ${label}` : 'Drag to reorder'}
        {...tip('Drag to reorder')}
      >
        <Ionicons name="reorder-three" size={compact ? 17 : 21} color={AppTheme.colors.textSecondary} />
      </View>
      <TouchableOpacity
        onPress={stop(onMoveDown)}
        disabled={!canMoveDown}
        style={{ padding: pad, opacity: canMoveDown ? 1 : 0.25 }}
        hitSlop={{ top: 2, bottom: 4, left: 6, right: 6 }}
        accessibilityLabel={label ? `Move ${label} down` : 'Move down'}
        {...tip('Move down')}
      >
        <Ionicons name="chevron-down" size={arrow} color={AppTheme.colors.primary} />
      </TouchableOpacity>
    </View>
  );
}
