import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, PanResponder, PanResponderInstance, View } from 'react-native';
import { StorageService } from '../utils/storage';

/**
 * A user-arranged order for a list, kept as the items' keys. Only keys are
 * stored — never names — so nothing about the vault's contents leaves the
 * encrypted database. `storageKey` is null until the owner (user, tab) is known.
 */
export function useCustomOrder(storageKey: string | null) {
  const [order, setOrderState] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setOrderState([]);
    if (!storageKey) return;
    StorageService.getItem(storageKey).then(saved => {
      if (cancelled || !saved) return;
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setOrderState(parsed.map(String));
      } catch (e) {
        // A damaged entry just means the list starts from its default order
      }
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  const setOrder = (keys: string[]) => {
    setOrderState(keys);
    if (storageKey) StorageService.setItem(storageKey, JSON.stringify(keys));
  };

  return { order, setOrder };
}

/**
 * `items` in the saved order. Anything the saved order has not seen yet — an
 * item added since the list was last arranged — goes on top, in the order it
 * arrived in, which is where someone who just added it will look for it.
 */
export function applyCustomOrder<T>(items: T[], keyOf: (item: T) => string, order: string[]): T[] {
  const position = new Map(order.map((key, index) => [key, index]));
  const unseen: T[] = [];
  const placed: T[] = [];
  for (const item of items) {
    (position.has(keyOf(item)) ? placed : unseen).push(item);
  }
  placed.sort((a, b) => position.get(keyOf(a))! - position.get(keyOf(b))!);
  return [...unseen, ...placed];
}

/** `keys` with the item at `from` moved to `to`. */
export function moveKey(keys: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) return keys;
  const next = [...keys];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Drag-to-reorder for a plain FlatList, without a gesture library. The row
 * is dragged by its handle; as it passes half of a neighbour, the two swap in
 * the list and the drag carries on from the new slot, so the rows around it
 * make room as it goes. Nothing is saved until the finger lifts.
 *
 * `keys` is the list as currently shown, `onCommit` receives the new order.
 */
export function useDragReorder(keys: string[], onCommit: (keys: string[]) => void) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  const heights = useRef(new Map<string, number>());
  const drag = useRef<{ key: string; order: string[]; shift: number } | null>(null);
  const activeRef = useRef<string | null>(null);

  // Read by the responders, which are made once per row and would otherwise
  // hold on to the list as it was when they were made
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const finish = () => {
    const current = drag.current;
    drag.current = null;
    activeRef.current = null;
    translateY.setValue(0);
    setActiveKey(null);
    setDraft(null);
    if (current && current.order.join('\u0000') !== keysRef.current.join('\u0000')) {
      commitRef.current(current.order);
    }
  };

  const responders = useRef(new Map<string, PanResponderInstance>());
  const handlersFor = (key: string) => {
    let responder = responders.current.get(key);
    if (!responder) {
      responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        // The list must not take the gesture over as a scroll mid-drag
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          drag.current = { key, order: [...keysRef.current], shift: 0 };
          activeRef.current = key;
          translateY.setValue(0);
          setActiveKey(key);
          setDraft(drag.current.order);
        },
        onPanResponderMove: (_e, gesture) => {
          const current = drag.current;
          if (!current) return;
          const { order } = current;
          let index = order.indexOf(key);
          let offset = gesture.dy - current.shift;
          let moved = false;
          const fallback = heights.current.get(key) || 60;

          while (offset > 0 && index < order.length - 1) {
            const below = heights.current.get(order[index + 1]) || fallback;
            if (offset < below / 2) break;
            order[index] = order[index + 1];
            order[index + 1] = key;
            current.shift += below;
            offset -= below;
            index += 1;
            moved = true;
          }
          while (offset < 0 && index > 0) {
            const above = heights.current.get(order[index - 1]) || fallback;
            if (-offset < above / 2) break;
            order[index] = order[index - 1];
            order[index - 1] = key;
            current.shift -= above;
            offset += above;
            index -= 1;
            moved = true;
          }

          if (moved) setDraft([...order]);
          translateY.setValue(offset);
        },
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
      });
      responders.current.set(key, responder);
    }
    return responder.panHandlers;
  };

  /** Props for the view wrapping each row: its measured height and, while dragged, its lift. */
  const rowProps = (key: string) => ({
    onLayout: (e: LayoutChangeEvent) => { heights.current.set(key, e.nativeEvent.layout.height); },
    style: activeKey === key
      ? { transform: [{ translateY }], zIndex: 10, elevation: 10, opacity: 0.92 }
      : undefined,
  });

  /**
   * Each FlatList cell is drawn over the ones before it, so a row dragged
   * downwards would slide underneath its neighbours. The cell holding it is
   * lifted above the rest for as long as the drag lasts.
   */
  const keyOfRef = useRef<(item: any) => string>(() => '');
  const cellRendererRef = useRef<React.ComponentType<any> | null>(null);
  const cellRendererFor = (keyOf: (item: any) => string) => {
    keyOfRef.current = keyOf;
    if (!cellRendererRef.current) {
      cellRendererRef.current = ({ item, style, onLayout, onFocusCapture, children }: any) => {
        const lifted = !!activeRef.current && keyOfRef.current(item) === activeRef.current;
        return React.createElement(
          View,
          { style: lifted ? [style, { zIndex: 999, elevation: 999 }] : style, onLayout, onFocusCapture } as any,
          children,
        );
      };
    }
    return cellRendererRef.current;
  };

  const orderedKeys = useMemo(() => draft || keys, [draft, keys]);

  return {
    /** The keys in the order to render them, which changes live during a drag. */
    orderedKeys,
    isDragging: activeKey !== null,
    activeKey,
    handlersFor,
    rowProps,
    cellRendererFor,
  };
}
