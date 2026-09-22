import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, PanResponder, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme, hexToHsl, hslToHex } from '../theme/AppTheme';
import { useLockerStore } from '../store/useLockerStore';

interface ColorPickerModalProps {
  visible: boolean;
  /** The colour the sliders open on. */
  value: string;
  title?: string;
  hint?: string;
  onSelect: (hex: string) => void;
  onClose: () => void;
}

/**
 * How many blocks each slider is drawn from. React Native has no gradient of
 * its own, so a strip of solid blocks stands in for one; at this width they
 * read as continuous, while the value itself comes from where the finger is
 * rather than from which block it landed on.
 */
const BANDS = 48;

interface SliderProps {
  label: string;
  /** 0..1 along the strip. */
  ratio: number;
  /** The colour of the strip at a given position, 0..1. */
  colorAt: (position: number) => string;
  onChange: (ratio: number) => void;
}

function ColorSlider({ label, ratio, colorAt, onChange }: SliderProps) {
  // Its own copy: none of these are accent colours, so they never need rebuilding
  const styles = useMemo(() => createStyles(), []);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  // Where the strip starts across the screen. iOS reports locationX against
  // whichever view the touch is currently over rather than the one the gesture
  // began on, so a drag returned positions from the wrong origin and the
  // colour never followed the finger. Screen coordinates are the same on every
  // platform, so the offset is measured once and subtracted here.
  const pageOffsetRef = useRef(0);
  const trackRef = useRef<View | null>(null);
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; });

  const measure = (then?: () => void) => {
    if (!trackRef.current) { then?.(); return; }
    trackRef.current.measureInWindow((x) => {
      if (typeof x === 'number' && !isNaN(x)) pageOffsetRef.current = x;
      then?.();
    });
  };

  const bands = useMemo(
    () => Array.from({ length: BANDS }, (_, i) => colorAt(i / (BANDS - 1))),
    [colorAt]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e, gesture) => {
          // Re-measured on the way in, in case the window moved since layout
          const pageX = pageXOf(e, gesture);
          measure(() => report(pageX));
        },
        onPanResponderMove: (e, gesture) => report(pageXOf(e, gesture)),
      }),
    []
  );

  /** The touch's position across the screen, whichever of the two carries it. */
  const pageXOf = (e: any, gesture: any): number => {
    const fromEvent = e?.nativeEvent?.pageX;
    if (typeof fromEvent === 'number' && !isNaN(fromEvent)) return fromEvent;
    const fromGesture = gesture?.moveX || gesture?.x0;
    return typeof fromGesture === 'number' ? fromGesture : 0;
  };

  const report = (pageX: number) => {
    const w = widthRef.current;
    if (!w) return;
    const x = pageX - pageOffsetRef.current;
    changeRef.current(Math.min(Math.max(x / w, 0), 1));
  };

  return (
    <View style={styles.sliderBlock}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <View
        ref={trackRef}
        collapsable={false}
        style={styles.sliderTrack}
        onLayout={e => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
          requestAnimationFrame(() => measure());
        }}
        {...responder.panHandlers}
      >
        {/* The blocks never take the touch themselves, so the position
            reported is always measured against the whole strip */}
        <View style={styles.bandRow} pointerEvents="none">
          {bands.map((color, i) => (
            <View key={i} style={[styles.band, { backgroundColor: color }]} />
          ))}
        </View>
        {width > 0 && (
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: Math.min(Math.max(ratio * width - 11, 0), Math.max(width - 22, 0)) }]}
          />
        )}
      </View>
    </View>
  );
}

/**
 * Mixes a colour by hue, then how much of it, then how light. Three sliders
 * rather than a square: dragging inside a square is fiddly on a phone, and this
 * way each part of the colour can be nudged without disturbing the others.
 */
export default function ColorPickerModal({
  visible,
  value,
  title = 'Custom colour',
  hint,
  onSelect,
  onClose,
}: ColorPickerModalProps) {
  const themeVersion = useLockerStore(state => state.themeVersion);
  // Rebuilt per accent: the button below is painted in it, and a stylesheet
  // built once would keep the colour the app started with
  const styles = useMemo(() => createStyles(), [themeVersion]);
  const [hsl, setHsl] = useState(() => hexToHsl(value));

  // Reopening starts from whatever is in use now, not from the last mix
  useEffect(() => {
    if (visible) setHsl(hexToHsl(value));
  }, [visible, value]);

  const hex = hslToHex(hsl.h, hsl.s, hsl.l);

  const hueAt = useMemo(() => (position: number) => hslToHex(position * 360, 90, 50), []);
  const satAt = useMemo(() => (position: number) => hslToHex(hsl.h, position * 100, hsl.l), [hsl.h, hsl.l]);
  const lightAt = useMemo(() => (position: number) => hslToHex(hsl.h, hsl.s, position * 100), [hsl.h, hsl.s]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
              <Ionicons name="close-circle-outline" size={24} color={AppTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {!!hint && <Text style={styles.hint}>{hint}</Text>}

          <View style={styles.previewRow}>
            <View style={[styles.preview, { backgroundColor: hex }]} />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.previewLabel}>Selected</Text>
              <Text style={styles.previewHex}>{hex.toUpperCase()}</Text>
            </View>
          </View>

          <ColorSlider
            label="Colour"
            ratio={hsl.h / 360}
            colorAt={hueAt}
            onChange={r => setHsl(prev => ({ ...prev, h: Math.round(r * 360) }))}
          />
          <ColorSlider
            label="Strength"
            ratio={hsl.s / 100}
            colorAt={satAt}
            onChange={r => setHsl(prev => ({ ...prev, s: Math.round(r * 100) }))}
          />
          <ColorSlider
            label="Lightness"
            ratio={hsl.l / 100}
            colorAt={lightAt}
            onChange={r => setHsl(prev => ({ ...prev, l: Math.round(r * 100) }))}
          />

          <TouchableOpacity style={styles.useBtn} onPress={() => { onSelect(hex); onClose(); }}>
            <Text style={styles.useBtnText}>Use this colour</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = () => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 18,
  },
  card: { backgroundColor: '#ffffff', borderRadius: 18, padding: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '800', color: AppTheme.colors.text },
  hint: { fontSize: 12, color: AppTheme.colors.textSecondary, marginTop: 4 },
  previewRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginBottom: 6 },
  preview: {
    width: 54,
    height: 54,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.12)',
  },
  previewLabel: { fontSize: 11, color: AppTheme.colors.textSecondary, fontWeight: '600' },
  previewHex: { fontSize: 16, fontWeight: '800', color: AppTheme.colors.text, letterSpacing: 0.5 },
  sliderBlock: { marginTop: 14 },
  sliderLabel: { fontSize: 11.5, fontWeight: '700', color: AppTheme.colors.textSecondary, marginBottom: 6 },
  sliderTrack: { height: 30, borderRadius: 8, justifyContent: 'center' },
  bandRow: { flexDirection: 'row', height: 30, borderRadius: 8, overflow: 'hidden' },
  band: { flex: 1, height: 30 },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  useBtn: {
    marginTop: 20,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: AppTheme.colors.primary,
  },
  useBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
});
