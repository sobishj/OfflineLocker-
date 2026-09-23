import React, { useRef, useState } from 'react';
import {
  View,
  Image,
  Animated,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  Text,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';

interface ZoomableImageProps {
  uri: string;
  maxScale?: number;
  minScale?: number;
  height?: number;
}

type Point = { x: number; y: number };

const distance = (t: { pageX: number; pageY: number }[]) =>
  Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

const midpoint = (t: { pageX: number; pageY: number }[]): Point => ({
  x: (t[0].pageX + t[1].pageX) / 2,
  y: (t[0].pageY + t[1].pageY) / 2,
});

/**
 * An image that zooms with two fingers and pans with one once zoomed.
 *
 * The responder is built once, so everything it reads lives in refs - a
 * closure over state would keep the zero-sized first layout forever and
 * clamp every pan back to the middle.
 */
export default function ZoomableImage({
  uri,
  maxScale = 5,
  minScale = 1,
  height = 500,
}: ZoomableImageProps) {
  const [displayScale, setDisplayScale] = useState(1);

  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const containerRef = useRef<View>(null);
  const size = useRef({ width: 0, height });
  // Page position of the container's centre, taken when a gesture starts
  // because the surrounding list may have scrolled since layout
  const centre = useRef<Point | null>(null);

  const currentScale = useRef(1);
  const currentPan = useRef<Point>({ x: 0, y: 0 });

  // Where the pinch began, so each move is worked out from a fixed base
  // rather than piling up rounding from frame to frame
  const pinch = useRef<{ dist: number; scale: number; focal: Point; pan: Point } | null>(null);
  const lastTouch = useRef<Point | null>(null);
  const lastTap = useRef(0);

  const clampPan = (p: Point, s: number): Point => {
    if (s <= 1.01) return { x: 0, y: 0 };
    const maxX = (size.current.width * (s - 1)) / 2;
    const maxY = (size.current.height * (s - 1)) / 2;
    return {
      x: Math.min(Math.max(p.x, -maxX), maxX),
      y: Math.min(Math.max(p.y, -maxY), maxY),
    };
  };

  const apply = (s: number, p: Point) => {
    currentScale.current = s;
    currentPan.current = p;
    scale.setValue(s);
    pan.setValue(p);
  };

  const animateTo = (targetScale: number, target: Point = { x: 0, y: 0 }) => {
    const s = Math.min(Math.max(targetScale, minScale), maxScale);
    const p = clampPan(target, s);
    currentScale.current = s;
    currentPan.current = p;
    setDisplayScale(s);
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true, friction: 7, tension: 40 }),
      Animated.spring(pan, { toValue: p, useNativeDriver: true, friction: 7, tension: 40 }),
    ]).start();
  };

  const measureCentre = () => {
    containerRef.current?.measure((_x, _y, w, h, pageX, pageY) => {
      if (w > 0 && h > 0) centre.current = { x: pageX + w / 2, y: pageY + h / 2 };
    });
  };

  const beginPinch = (touches: GestureResponderEvent['nativeEvent']['touches']) => {
    pinch.current = {
      dist: Math.max(distance(touches), 1),
      scale: currentScale.current,
      focal: midpoint(touches),
      pan: { ...currentPan.current },
    };
    lastTouch.current = null;
  };

  const settle = () => {
    pinch.current = null;
    lastTouch.current = null;
    if (currentScale.current <= 1.05) {
      animateTo(1);
    } else {
      animateTo(currentScale.current, currentPan.current);
    }
  };

  const isZoomed = () => currentScale.current > 1.05;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Claim a second finger or a drag on a zoomed image before the page's
      // scroll view can, since it would otherwise scroll instead
      onStartShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2 || isZoomed(),
      onMoveShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2 || isZoomed(),
      // At rest, a one-finger drag belongs to the page so it can still scroll
      onPanResponderTerminationRequest: () => !pinch.current && !isZoomed(),

      onPanResponderGrant: (e) => {
        measureCentre();
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          beginPinch(touches);
          return;
        }
        const now = Date.now();
        if (now - lastTap.current < 300) {
          lastTap.current = 0;
          animateTo(isZoomed() ? 1 : 2.5);
          return;
        }
        lastTap.current = now;
        lastTouch.current = { x: touches[0].pageX, y: touches[0].pageY };
      },

      onPanResponderMove: (e) => {
        const touches = e.nativeEvent.touches;

        if (touches.length >= 2) {
          // The second finger usually lands a moment after the first
          if (!pinch.current) beginPinch(touches);
          const start = pinch.current!;
          const s = Math.min(Math.max(start.scale * (distance(touches) / start.dist), minScale * 0.8), maxScale * 1.2);
          const focal = midpoint(touches);
          // Keep the spot between the fingers under the fingers as it grows,
          // and let both fingers drag the image along at the same time
          const offset = centre.current
            ? { x: start.focal.x - centre.current.x - start.pan.x, y: start.focal.y - centre.current.y - start.pan.y }
            : { x: 0, y: 0 };
          const ratio = s / start.scale;
          const next = {
            x: start.pan.x + (focal.x - start.focal.x) + offset.x * (1 - ratio),
            y: start.pan.y + (focal.y - start.focal.y) + offset.y * (1 - ratio),
          };
          apply(s, clampPan(next, Math.max(s, 1)));
          return;
        }

        if (touches.length === 1) {
          // Lifting one finger of a pinch carries on as a drag from here
          if (pinch.current) {
            pinch.current = null;
            lastTouch.current = null;
          }
          const t = { x: touches[0].pageX, y: touches[0].pageY };
          if (lastTouch.current && isZoomed()) {
            const next = {
              x: currentPan.current.x + (t.x - lastTouch.current.x),
              y: currentPan.current.y + (t.y - lastTouch.current.y),
            };
            apply(currentScale.current, clampPan(next, currentScale.current));
          }
          lastTouch.current = t;
        }
      },

      onPanResponderRelease: settle,
      onPanResponderTerminate: settle,
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    if (width > 0 && h > 0) size.current = { width, height: h };
  };

  return (
    <View
      ref={containerRef}
      style={[styles.container, { height }]}
      onLayout={onLayout}
      {...responder.panHandlers}
    >
      <Animated.View
        style={[
          styles.imageWrapper,
          { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale }] },
        ]}
      >
        <Image source={{ uri }} style={styles.image} resizeMode="contain" />
      </Animated.View>

      {/* Only shown while zoomed, as a way back to the whole image */}
      {displayScale > 1.05 && (
        <TouchableOpacity onPress={() => animateTo(1)} style={styles.scaleBadge} activeOpacity={0.7}>
          <Text style={styles.scaleText}>{Math.round(displayScale * 100)}%</Text>
        </TouchableOpacity>
      )}
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
  scaleBadge: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  scaleText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
});
