import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Image,
  Animated,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  Text,
  LayoutChangeEvent,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ZoomableImageProps {
  uri: string;
  maxScale?: number;
  minScale?: number;
  height?: number;
}

export default function ZoomableImage({
  uri,
  maxScale = 4.5,
  minScale = 1.0,
  height = 500,
}: ZoomableImageProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height });
  const [displayScale, setDisplayScale] = useState(1.0);

  // Animated values
  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Track values imperatively for gesture math
  const currentScale = useRef(1);
  const currentPan = useRef({ x: 0, y: 0 });
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef(1);
  const lastTap = useRef<number>(0);

  // Clamp pan based on container and current scale
  const clampPan = useCallback((x: number, y: number, s: number) => {
    if (s <= 1.01) {
      return { x: 0, y: 0 };
    }
    const maxPanX = (containerSize.width * (s - 1)) / 2;
    const maxPanY = (containerSize.height * (s - 1)) / 2;
    return {
      x: Math.min(Math.max(x, -maxPanX), maxPanX),
      y: Math.min(Math.max(y, -maxPanY), maxPanY),
    };
  }, [containerSize]);

  const animateTo = useCallback((targetScale: number, targetX: number = 0, targetY: number = 0) => {
    const clampedScale = Math.min(Math.max(targetScale, minScale), maxScale);
    const clampedPos = clampPan(targetX, targetY, clampedScale);

    currentScale.current = clampedScale;
    currentPan.current = clampedPos;
    setDisplayScale(clampedScale);

    Animated.parallel([
      Animated.spring(scale, {
        toValue: clampedScale,
        useNativeDriver: true,
        friction: 7,
        tension: 40,
      }),
      Animated.spring(pan, {
        toValue: clampedPos,
        useNativeDriver: true,
        friction: 7,
        tension: 40,
      }),
    ]).start();
  }, [clampPan, maxScale, minScale, pan, scale]);

  const handleZoomIn = () => {
    const next = Math.min(currentScale.current + 0.5, maxScale);
    animateTo(next, currentPan.current.x, currentPan.current.y);
  };

  const handleZoomOut = () => {
    const next = Math.max(currentScale.current - 0.5, minScale);
    if (next <= 1.01) {
      animateTo(1.0, 0, 0);
    } else {
      animateTo(next, currentPan.current.x, currentPan.current.y);
    }
  };

  const handleResetZoom = () => {
    animateTo(1.0, 0, 0);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => {
        // Only take gestures if multi-touch OR if already zoomed in and dragging
        return gesture.numberActiveTouches === 2 || currentScale.current > 1.05;
      },
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          initialDistance.current = Math.hypot(dx, dy);
          initialScale.current = currentScale.current;
        } else if (touches.length === 1) {
          // Check for double tap
          const now = Date.now();
          if (now - lastTap.current < 300) {
            // Double tapped!
            if (currentScale.current > 1.2) {
              animateTo(1.0, 0, 0);
            } else {
              animateTo(2.5, 0, 0);
            }
            lastTap.current = 0;
            return;
          }
          lastTap.current = now;
        }
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2 && initialDistance.current) {
          const dx = touches[0].pageX - touches[1].pageX;
          const dy = touches[0].pageY - touches[1].pageY;
          const currentDistance = Math.hypot(dx, dy);
          const factor = currentDistance / initialDistance.current;
          const target = Math.min(Math.max(initialScale.current * factor, minScale), maxScale);

          currentScale.current = target;
          setDisplayScale(target);
          scale.setValue(target);

          const clamped = clampPan(currentPan.current.x, currentPan.current.y, target);
          pan.setValue(clamped);
        } else if (touches.length === 1 && currentScale.current > 1.05) {
          const nextX = currentPan.current.x + gesture.dx;
          const nextY = currentPan.current.y + gesture.dy;
          const clamped = clampPan(nextX, nextY, currentScale.current);
          pan.setValue(clamped);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (initialDistance.current !== null) {
          initialDistance.current = null;
        }

        if (currentScale.current > 1.05) {
          const nextX = currentPan.current.x + gesture.dx;
          const nextY = currentPan.current.y + gesture.dy;
          const clamped = clampPan(nextX, nextY, currentScale.current);
          currentPan.current = clamped;
          Animated.spring(pan, {
            toValue: clamped,
            useNativeDriver: true,
            friction: 7,
          }).start();
        } else {
          animateTo(1.0, 0, 0);
        }
      },
      onPanResponderTerminate: () => {
        initialDistance.current = null;
        if (currentScale.current <= 1.05) {
          animateTo(1.0, 0, 0);
        }
      },
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    if (width > 0 && h > 0) {
      setContainerSize({ width, height: h });
    }
  };

  return (
    <View
      style={[styles.container, { height }]}
      onLayout={onLayout}
      {...panResponder.panHandlers}
    >
      <Animated.View
        style={[
          styles.imageWrapper,
          {
            transform: [
              { translateX: pan.x },
              { translateY: pan.y },
              { scale },
            ],
          },
        ]}
      >
        <Image
          source={{ uri }}
          style={styles.image}
          resizeMode="contain"
        />
      </Animated.View>

      {/* Floating Zoom Controls Pill */}
      <View style={styles.floatingControls}>
        <TouchableOpacity
          onPress={handleZoomOut}
          style={styles.zoomButton}
          activeOpacity={0.7}
          disabled={displayScale <= 1.05}
        >
          <Ionicons
            name="remove"
            size={18}
            color={displayScale <= 1.05 ? '#64748b' : '#ffffff'}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleResetZoom}
          style={styles.scaleDisplay}
          activeOpacity={0.7}
        >
          <Text style={styles.scaleText}>
            {Math.round(displayScale * 100)}%
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleZoomIn}
          style={styles.zoomButton}
          activeOpacity={0.7}
          disabled={displayScale >= maxScale - 0.05}
        >
          <Ionicons
            name="add"
            size={18}
            color={displayScale >= maxScale - 0.05 ? '#64748b' : '#ffffff'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  floatingControls: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  zoomButton: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scaleDisplay: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scaleText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
});
