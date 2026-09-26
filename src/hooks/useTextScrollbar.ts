import { useCallback, useState } from 'react';
import { LayoutChangeEvent, Platform, TextInputContentSizeChangeEvent, TextInputScrollEvent } from 'react-native';

const MIN_THUMB = 28;

/**
 * Where to draw a scroll thumb beside a long multiline input. iOS draws its
 * own; Android's text field never does, so once a page outgrows the space the
 * keyboard leaves it, nothing showed there was more above or below.
 */
export function useTextScrollbar() {
  const [viewHeight, setViewHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [offset, setOffset] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => setViewHeight(e.nativeEvent.layout.height), []);
  const onContentSizeChange = useCallback(
    (e: TextInputContentSizeChangeEvent) => setContentHeight(e.nativeEvent.contentSize.height),
    []
  );
  const onScroll = useCallback(
    (e: TextInputScrollEvent) => setOffset(e.nativeEvent.contentOffset?.y || 0),
    []
  );

  let thumb: { top: number; height: number } | null = null;
  if (Platform.OS === 'android' && viewHeight > 0 && contentHeight > viewHeight + 1) {
    const height = Math.max(MIN_THUMB, (viewHeight * viewHeight) / contentHeight);
    const travel = viewHeight - height;
    const ratio = Math.min(Math.max(offset / (contentHeight - viewHeight), 0), 1);
    thumb = { top: travel * ratio, height };
  }

  return {
    /** Spread onto the TextInput. */
    inputProps: { onLayout, onContentSizeChange, onScroll },
    /** Null when there is nothing to scroll, or the platform draws its own. */
    thumb,
  };
}
