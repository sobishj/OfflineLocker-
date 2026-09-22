import React, { useRef, useEffect } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';

const FAB_SIZE = 52;
const DEFAULT_STORAGE_KEY = '@offline_locker_fab_position';

// Keyed by storage key: each list keeps its own button where its owner left it,
// and a shared cache would have handed one screen's position to another.
const cachedFabPositions: Record<string, { x: number; y: number }> = {};

const getItem = async (key: string): Promise<string | null> => {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    return await AsyncStorage.getItem(key);
  } catch (e) {
    return null;
  }
};

const setItem = async (key: string, value: string): Promise<void> => {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  } catch (e) {}
};

interface DraggableFABProps {
  onPress: () => void;
  iconName?: keyof typeof Ionicons.glyphMap;
  initialBottom?: number;
  initialRight?: number;
  title?: string;
  storageKey?: string;
}

export default function DraggableFAB({
  onPress,
  iconName = 'add',
  initialBottom = 30,
  initialRight = 30,
  title = 'Add New Item',
  storageKey = DEFAULT_STORAGE_KEY,
}: DraggableFABProps) {
  const pan = useRef(
    new Animated.ValueXY(cachedFabPositions[storageKey] || { x: 0, y: 0 })
  ).current;

  const clampPosition = (x: number, y: number) => {
    const { width, height } = Dimensions.get('window');
    const minX = -(width - initialRight - FAB_SIZE - 16);
    const maxX = initialRight - 16;
    const minY = -(height - initialBottom - FAB_SIZE - 50);
    const maxY = initialBottom - 16;

    const clampedX = Math.min(Math.max(x, minX), maxX);
    const clampedY = Math.min(Math.max(y, minY), maxY);
    return { x: clampedX, y: clampedY };
  };

  const savePosition = (x: number, y: number) => {
    cachedFabPositions[storageKey] = { x, y };
    setItem(storageKey, JSON.stringify({ x, y }));
  };

  useEffect(() => {
    let isMounted = true;
    const loadPosition = async () => {
      try {
        const saved = await getItem(storageKey);
        if (saved && isMounted) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            const { x: clampedX, y: clampedY } = clampPosition(parsed.x, parsed.y);
            cachedFabPositions[storageKey] = { x: clampedX, y: clampedY };
            pan.setValue({ x: clampedX, y: clampedY });
          }
        }
      } catch (e) {}
    };
    loadPosition();
    return () => {
      isMounted = false;
    };
  }, [storageKey]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4;
      },
      onMoveShouldSetPanResponderCapture: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4;
      },
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        const rawX = (pan.x as any)._value;
        const rawY = (pan.y as any)._value;
        const { x: clampedX, y: clampedY } = clampPosition(rawX, rawY);
        if (clampedX !== rawX || clampedY !== rawY) {
          Animated.spring(pan, {
            toValue: { x: clampedX, y: clampedY },
            useNativeDriver: false,
          }).start();
        }
        savePosition(clampedX, clampedY);
      },
      onPanResponderTerminate: () => {
        pan.flattenOffset();
        const rawX = (pan.x as any)._value;
        const rawY = (pan.y as any)._value;
        const { x: clampedX, y: clampedY } = clampPosition(rawX, rawY);
        savePosition(clampedX, clampedY);
      },
    })
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.fabContainer,
        {
          bottom: initialBottom,
          right: initialRight,
          transform: pan.getTranslateTransform(),
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        // Read here rather than in the stylesheet, which would hold the colour
        // the app started with rather than the accent in use now
        style={[styles.fabButton, { backgroundColor: AppTheme.colors.primary, shadowColor: AppTheme.colors.primary }]}
        {...(Platform.OS === 'web' ? { title } : {})}
      >
        <Ionicons name={iconName} size={26} color="#ffffff" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    position: 'absolute',
    zIndex: 99999,
    elevation: 20,
  },
  fabButton: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
});
