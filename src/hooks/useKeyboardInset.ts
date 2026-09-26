import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, KeyboardEvent, Platform, TextInput, View } from 'react-native';

/**
 * How much of a view the keyboard covers, so a writing area can pad itself up
 * out from under it.
 *
 * With edge-to-edge on, Android no longer resizes the window for the keyboard,
 * and a full-screen modal was never resized on either platform. Measuring is
 * the one answer that holds everywhere: where the view ends against where the
 * keyboard starts. If the system did resize the window after all, the view
 * already ends above the keyboard and the overlap simply comes out as none.
 *
 * Also hands back tap handlers for a multiline input, so each tap on the page
 * toggles the keyboard: up when it is down, down when it is up.
 */
export function useKeyboardInset(inputRef: RefObject<TextInput | null>) {
  const containerRef = useRef<View | null>(null);
  const [inset, setInset] = useState(0);
  const keyboardRef = useRef<{ top: number; height: number } | null>(null);
  // Read at the start of a tap: by the time it lifts, the tap itself may
  // already have raised the keyboard
  const visibleAtPressRef = useRef(false);

  const measure = useCallback(() => {
    const keyboard = keyboardRef.current;
    const view = containerRef.current;
    if (!keyboard || !view) {
      setInset(0);
      return;
    }
    view.measureInWindow((_x, y, _w, h) => {
      if (typeof y !== 'number' || isNaN(y) || typeof h !== 'number') return;
      // Never more than the keyboard itself, whatever the coordinates say.
      // Android leaves the navigation bar out of the height it reports, while
      // an edge-to-edge view runs down behind it, so the gap below the
      // keyboard's top edge counts too.
      const limit = Math.max(keyboard.height, Dimensions.get('screen').height - keyboard.top);
      const overlap = Math.min(Math.max(Math.round(y + h - keyboard.top), 0), Math.round(limit));
      setInset(overlap);
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onShow = (e: KeyboardEvent) => {
      keyboardRef.current = { top: e.endCoordinates.screenY, height: e.endCoordinates.height };
      measure();
      // Once more after any opening slide, which the first reading may have
      // caught part way up the screen
      clearTimeout(settle);
      settle = setTimeout(measure, 400);
    };
    const subs = [
      Keyboard.addListener(showEvent, onShow),
      Keyboard.addListener(hideEvent, () => {
        keyboardRef.current = null;
        setInset(0);
      }),
    ];
    // The keyboard changing size while up, such as switching to emoji
    if (Platform.OS === 'ios') subs.push(Keyboard.addListener('keyboardWillChangeFrame', onShow));
    return () => {
      clearTimeout(settle);
      subs.forEach(s => s.remove());
    };
  }, [measure]);

  const onPressIn = useCallback(() => {
    // Focus counts as well: a keyboard raised over a modal on Android does not
    // always report itself
    visibleAtPressRef.current =
      keyboardRef.current != null || Keyboard.isVisible() || !!inputRef.current?.isFocused();
  }, [inputRef]);

  const onPress = useCallback(() => {
    if (visibleAtPressRef.current) {
      // Deferred past the input's own press handling, which focuses it
      setTimeout(() => {
        inputRef.current?.blur();
        Keyboard.dismiss();
      }, 0);
    }
  }, [inputRef]);

  return {
    /** Put on the view that holds the writing area. */
    containerRef,
    /** Re-measured on layout, in case the window did move after all. */
    onLayout: measure,
    /** Padding to add under the writing area. */
    inset,
    /** Spread onto the multiline TextInput. */
    tapToggle: { onPressIn, onPress },
  };
}
