import React, { useState, useRef, useEffect } from 'react';
import { View, Image, StyleSheet, PanResponder, TouchableOpacity, Text, ActivityIndicator, GestureResponderEvent, PanResponderGestureState } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { AppTheme } from '../theme/AppTheme';

interface Props {
  imageUri: string; // data:image/jpeg;base64,... or file:// URI
  onCropDone: (croppedBase64DataUri: string) => void;
  onCancel: () => void;
}

const HANDLE_TOUCH = 44; // Touch hit area size
const MIN_CROP = 40;     // Minimum crop box size in screen pixels
const ACCENT = AppTheme.colors.primary;

export default function CustomImageCropper({ imageUri, onCropDone, onCancel }: Props) {
  const [preparing, setPreparing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [normalizedUri, setNormalizedUri] = useState<string | null>(null);
  const [normW, setNormW] = useState(0);
  const [normH, setNormH] = useState(0);
  const [cW, setCW] = useState(0);
  const [cH, setCH] = useState(0);
  const [imgR, setImgR] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState({ l: 0, t: 0, r: 0, b: 0 });

  const cropRef = useRef(crop);
  const imgRRef = useRef(imgR);
  const startRef = useRef(crop);
  
  useEffect(() => { cropRef.current = crop; }, [crop]);
  useEffect(() => { imgRRef.current = imgR; }, [imgR]);

  // 1. Prepare & normalize image to bake in EXIF orientation
  useEffect(() => {
    let isCurrent = true;
    const prepare = async () => {
      setPreparing(true);
      try {
        let inputUri = imageUri;
        if (imageUri.startsWith('data:')) {
          const parts = imageUri.split(',');
          const b64 = parts.length > 1 ? parts[1] : parts[0];
          inputUri = `${FileSystem.cacheDirectory}crop_raw_${Date.now()}.jpg`;
          await FileSystem.writeAsStringAsync(inputUri, b64, { encoding: 'base64' });
        }

        // manipulateAsync with empty actions array [] bakes in EXIF rotation
        // and returns physical upright width & height matching visual orientation.
        const res = await ImageManipulator.manipulateAsync(
          inputUri,
          [],
          { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
        );

        if (isCurrent && res && res.uri && res.width > 0 && res.height > 0) {
          setNormalizedUri(res.uri);
          setNormW(res.width);
          setNormH(res.height);
          setPreparing(false);
          return;
        }
      } catch (err) {
        console.warn('Image EXIF normalization error:', err);
      }

      // Fallback if normalization fails
      if (isCurrent) {
        setNormalizedUri(imageUri);
        Image.getSize(
          imageUri,
          (w, h) => {
            if (isCurrent) {
              setNormW(w);
              setNormH(h);
              setPreparing(false);
            }
          },
          () => {
            if (isCurrent) setPreparing(false);
          }
        );
      }
    };

    prepare();
    return () => { isCurrent = false; };
  }, [imageUri]);

  // 2. Compute rendered image bounds (imgR) and initial crop box
  useEffect(() => {
    if (normW > 0 && normH > 0 && cW > 0 && cH > 0) {
      const ir = normW / normH;
      const cr = cW / cH;
      let rw: number, rh: number, rx: number, ry: number;
      if (ir > cr) {
        rw = cW;
        rh = cW / ir;
        rx = 0;
        ry = (cH - rh) / 2;
      } else {
        rh = cH;
        rw = cH * ir;
        ry = 0;
        rx = (cW - rw) / 2;
      }
      const newImgR = { x: rx, y: ry, w: rw, h: rh };
      setImgR(newImgR);
      setCrop({ l: rx, t: ry, r: rx + rw, b: ry + rh });
    }
  }, [normW, normH, cW, cH]);

  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // 3. PanResponders for draggable borders & corners
  const mkPan = (k: string) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startRef.current = { ...cropRef.current }; },
    onPanResponderMove: (_: GestureResponderEvent, g: PanResponderGestureState) => {
      const s = startRef.current, r = imgRRef.current;
      if (!r.w || !r.h) return;
      let { l, t, r: ri, b } = s;
      if (k.includes('l')) l = cl(s.l + g.dx, r.x, s.r - MIN_CROP);
      if (k.includes('r')) ri = cl(s.r + g.dx, s.l + MIN_CROP, r.x + r.w);
      if (k.includes('t')) t = cl(s.t + g.dy, r.y, s.b - MIN_CROP);
      if (k.includes('b')) b = cl(s.b + g.dy, s.t + MIN_CROP, r.y + r.h);
      setCrop({ l, t, r: ri, b });
    },
  });

  const pTL = useRef(mkPan('tl')).current;
  const pTR = useRef(mkPan('tr')).current;
  const pBL = useRef(mkPan('bl')).current;
  const pBR = useRef(mkPan('br')).current;
  const pT = useRef(mkPan('t')).current;
  const pB = useRef(mkPan('b')).current;
  const pL = useRef(mkPan('l')).current;
  const pR = useRef(mkPan('r')).current;

  // 4. Crop execution math matching pixel-for-pixel visual crop box
  const doCrop = async () => {
    if (saving || preparing) return;
    setSaving(true);
    try {
      const targetUri = normalizedUri || imageUri;
      if (imgR.w > 0 && imgR.h > 0 && normW > 0 && normH > 0) {
        const scaleX = normW / imgR.w;
        const scaleY = normH / imgR.h;

        const rawOriginX = (crop.l - imgR.x) * scaleX;
        const rawOriginY = (crop.t - imgR.y) * scaleY;
        const rawWidth = (crop.r - crop.l) * scaleX;
        const rawHeight = (crop.b - crop.t) * scaleY;

        const originX = Math.max(0, Math.min(normW - 1, Math.round(rawOriginX)));
        const originY = Math.max(0, Math.min(normH - 1, Math.round(rawOriginY)));
        const width = Math.max(1, Math.min(normW - originX, Math.round(rawWidth)));
        const height = Math.max(1, Math.min(normH - originY, Math.round(rawHeight)));

        const res = await ImageManipulator.manipulateAsync(
          targetUri,
          [{ crop: { originX, originY, width, height } }],
          { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.5 }
        );

        if (res && res.base64) {
          onCropDone(`data:image/jpeg;base64,${res.base64}`);
          setSaving(false);
          return;
        }
      }
      onCropDone(imageUri);
    } catch (e) {
      console.error('Crop execution failed:', e);
      onCropDone(imageUri);
    }
    setSaving(false);
  };

  const w = crop.r - crop.l;
  const h = crop.b - crop.t;
  const isReady = !preparing && imgR.w > 0 && imgR.h > 0 && normalizedUri !== null;

  return (
    <View style={st.root}>
      {/* Header Bar */}
      <View style={st.hdr}>
        <TouchableOpacity onPress={onCancel} disabled={saving || preparing} style={st.hdrBtnContainer}>
          <Text style={st.hBtnText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={st.hTitle}>Adjust Borders</Text>
        <TouchableOpacity onPress={doCrop} style={st.doneB} disabled={saving || preparing || !isReady}>
          {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.doneT}>Done</Text>}
        </TouchableOpacity>
      </View>

      {/* Main Canvas */}
      <View
        style={st.canvas}
        onLayout={e => {
          setCW(e.nativeEvent.layout.width);
          setCH(e.nativeEvent.layout.height);
        }}
      >
        {preparing ? (
          <View style={st.centerLoading}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={{ color: '#AAA', marginTop: 12 }}>Loading image...</Text>
          </View>
        ) : (
          normalizedUri && (
            <Image
              source={{ uri: normalizedUri }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="contain"
            />
          )
        )}

        {isReady && (
          <>
            {/* Dark Overlays outside crop area */}
            <View style={[st.dim, { left: 0, top: 0, width: crop.l, height: cH }]} pointerEvents="none" />
            <View style={[st.dim, { left: crop.r, top: 0, right: 0, height: cH }]} pointerEvents="none" />
            <View style={[st.dim, { left: crop.l, top: 0, width: w, height: crop.t }]} pointerEvents="none" />
            <View style={[st.dim, { left: crop.l, top: crop.b, width: w, bottom: 0 }]} pointerEvents="none" />

            {/* Active Crop Box & Grid */}
            <View style={[st.bdr, { left: crop.l, top: crop.t, width: w, height: h }]} pointerEvents="box-none">
              <View style={[st.gH, { top: '33%' }]} pointerEvents="none" />
              <View style={[st.gH, { top: '66%' }]} pointerEvents="none" />
              <View style={[st.gV, { left: '33%' }]} pointerEvents="none" />
              <View style={[st.gV, { left: '66%' }]} pointerEvents="none" />
            </View>

            {/* Top Edge Handle */}
            <View
              style={[
                st.edgeTouch,
                {
                  left: crop.l + HANDLE_TOUCH / 2,
                  top: crop.t - HANDLE_TOUCH / 2,
                  width: Math.max(10, w - HANDLE_TOUCH),
                  height: HANDLE_TOUCH,
                },
              ]}
              {...pT.panHandlers}
            >
              <View style={st.edgeBarH} />
            </View>

            {/* Bottom Edge Handle */}
            <View
              style={[
                st.edgeTouch,
                {
                  left: crop.l + HANDLE_TOUCH / 2,
                  top: crop.b - HANDLE_TOUCH / 2,
                  width: Math.max(10, w - HANDLE_TOUCH),
                  height: HANDLE_TOUCH,
                },
              ]}
              {...pB.panHandlers}
            >
              <View style={st.edgeBarH} />
            </View>

            {/* Left Edge Handle */}
            <View
              style={[
                st.edgeTouch,
                {
                  left: crop.l - HANDLE_TOUCH / 2,
                  top: crop.t + HANDLE_TOUCH / 2,
                  width: HANDLE_TOUCH,
                  height: Math.max(10, h - HANDLE_TOUCH),
                },
              ]}
              {...pL.panHandlers}
            >
              <View style={st.edgeBarV} />
            </View>

            {/* Right Edge Handle */}
            <View
              style={[
                st.edgeTouch,
                {
                  left: crop.r - HANDLE_TOUCH / 2,
                  top: crop.t + HANDLE_TOUCH / 2,
                  width: HANDLE_TOUCH,
                  height: Math.max(10, h - HANDLE_TOUCH),
                },
              ]}
              {...pR.panHandlers}
            >
              <View style={st.edgeBarV} />
            </View>

            {/* 4 Corner Touch Handles */}
            {[
              { pan: pTL, x: crop.l, y: crop.t, arms: ['top', 'left'] },
              { pan: pTR, x: crop.r, y: crop.t, arms: ['top', 'right'] },
              { pan: pBL, x: crop.l, y: crop.b, arms: ['bottom', 'left'] },
              { pan: pBR, x: crop.r, y: crop.b, arms: ['bottom', 'right'] },
            ].map((c, i) => (
              <View
                key={i}
                style={[
                  st.cnrTouch,
                  {
                    left: c.x - HANDLE_TOUCH / 2,
                    top: c.y - HANDLE_TOUCH / 2,
                  },
                ]}
                {...c.pan.panHandlers}
              >
                {c.arms.includes('top') && c.arms.includes('left') && (
                  <>
                    <View style={[st.cornerArm, { left: HANDLE_TOUCH / 2 - 2, top: HANDLE_TOUCH / 2 - 2, width: 16, height: 4, borderRadius: 2 }]} />
                    <View style={[st.cornerArm, { left: HANDLE_TOUCH / 2 - 2, top: HANDLE_TOUCH / 2 - 2, width: 4, height: 16, borderRadius: 2 }]} />
                  </>
                )}
                {c.arms.includes('top') && c.arms.includes('right') && (
                  <>
                    <View style={[st.cornerArm, { right: HANDLE_TOUCH / 2 - 2, top: HANDLE_TOUCH / 2 - 2, width: 16, height: 4, borderRadius: 2 }]} />
                    <View style={[st.cornerArm, { right: HANDLE_TOUCH / 2 - 2, top: HANDLE_TOUCH / 2 - 2, width: 4, height: 16, borderRadius: 2 }]} />
                  </>
                )}
                {c.arms.includes('bottom') && c.arms.includes('left') && (
                  <>
                    <View style={[st.cornerArm, { left: HANDLE_TOUCH / 2 - 2, bottom: HANDLE_TOUCH / 2 - 2, width: 16, height: 4, borderRadius: 2 }]} />
                    <View style={[st.cornerArm, { left: HANDLE_TOUCH / 2 - 2, bottom: HANDLE_TOUCH / 2 - 2, width: 4, height: 16, borderRadius: 2 }]} />
                  </>
                )}
                {c.arms.includes('bottom') && c.arms.includes('right') && (
                  <>
                    <View style={[st.cornerArm, { right: HANDLE_TOUCH / 2 - 2, bottom: HANDLE_TOUCH / 2 - 2, width: 16, height: 4, borderRadius: 2 }]} />
                    <View style={[st.cornerArm, { right: HANDLE_TOUCH / 2 - 2, bottom: HANDLE_TOUCH / 2 - 2, width: 4, height: 16, borderRadius: 2 }]} />
                  </>
                )}
              </View>
            ))}
          </>
        )}
      </View>

      {/* Footer */}
      <View style={st.ftr}>
        <TouchableOpacity onPress={() => onCropDone(imageUri)} disabled={saving || preparing}>
          <Text style={st.skip}>Keep Original (Skip)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0C' },
  centerLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  hdr: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 14,
    paddingHorizontal: 20,
    backgroundColor: '#16161A',
    borderBottomWidth: 1,
    borderBottomColor: '#26262E',
  },
  hdrBtnContainer: { padding: 4 },
  hBtnText: { color: '#AAA', fontSize: 16 },
  hTitle: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  doneB: {
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  doneT: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  canvas: { flex: 1, position: 'relative' },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  bdr: { position: 'absolute', borderWidth: 2, borderColor: '#FFF' },
  gH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  gV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  edgeTouch: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  edgeBarH: {
    width: 32,
    height: 5,
    backgroundColor: ACCENT,
    borderRadius: 2.5,
  },
  edgeBarV: {
    width: 5,
    height: 32,
    backgroundColor: ACCENT,
    borderRadius: 2.5,
  },
  cnrTouch: {
    position: 'absolute',
    width: HANDLE_TOUCH,
    height: HANDLE_TOUCH,
  },
  cornerArm: {
    position: 'absolute',
    backgroundColor: ACCENT,
  },
  ftr: {
    alignItems: 'center',
    paddingVertical: 18,
    backgroundColor: '#16161A',
    borderTopWidth: 1,
    borderTopColor: '#26262E',
  },
  skip: { color: '#888', fontSize: 14, textDecorationLine: 'underline' },
});
