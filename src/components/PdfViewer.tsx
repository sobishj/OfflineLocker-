import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, Platform, StyleSheet, StyleProp, ViewStyle, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { writeCachedFile, cacheKeyForUri } from '../services/FileCacheService';
import { READ_ACCESS_ROOT } from '../services/PdfJsAssetService';

interface PdfViewerProps {
  uri: string;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
  singlePageOnly?: boolean;
}

/**
 * Android renders with the pdf.js copy bundled in `android_asset`, which is the
 * only way to get a PDF on screen there without a network.
 *
 * iOS does not need pdf.js at all: WKWebView renders a PDF from a file on its
 * own, with native quality, pinch-zoom and scrolling. It will not take a data
 * URI, though, so anything arriving as one is written to the cache first. The
 * previous build pointed iOS at a pdf.js copy on a CDN, which an offline app
 * can never reach - that is why every preview came up empty on an iPhone.
 */
export default function PdfViewer({
  uri,
  style,
  pointerEvents = 'auto',
  singlePageOnly = false,
}: PdfViewerProps) {
  const webViewRef = useRef<WebView>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [resolvedBase64, setResolvedBase64] = useState<string>('');
  // A file on disk is handed over as a path; only data URIs become base64 here
  const [resolvedFileUri, setResolvedFileUri] = useState<string>('');
  const [resolveError, setResolveError] = useState('');
  // The load handlers fire several times, and re-sending a large PDF each time
  // was costing seconds per attempt
  const deliveredRef = useRef<string>('');

  const isNativePdf = Platform.OS === 'ios';

  // Resolve uri to pure base64 (handling file:// disk paths, data URIs, or raw base64)
  useEffect(() => {
    let isMounted = true;

    async function resolveData() {
      if (!uri) {
        if (isMounted) { setResolvedBase64(''); setResolvedFileUri(''); }
        return;
      }
      if (isMounted) setResolveError('');

      if (uri.startsWith('file://')) {
        // Reading it back into a base64 string is exactly the work this is
        // meant to avoid; the page fetches the bytes for itself instead
        if (isMounted) { setResolvedFileUri(uri); setResolvedBase64(''); }
        return;
      }

      if (isNativePdf) {
        // WKWebView renders only from a file, so a data URI has to land on disk
        try {
          const path = await writeCachedFile(uri, `pdf_${cacheKeyForUri(uri)}`, 'pdf');
          if (isMounted) { setResolvedFileUri(path); setResolvedBase64(''); }
        } catch (e) {
          if (isMounted) setResolveError('This PDF could not be opened.');
        }
        return;
      }

      const raw = uri.includes('base64,') ? uri.split('base64,')[1] : uri;
      const clean = raw.replace(/[\r\n\s]/g, '').trim();
      if (isMounted) { setResolvedFileUri(''); setResolvedBase64(clean); }
    }

    resolveData();
    return () => {
      isMounted = false;
    };
  }, [uri, isNativePdf]);

  const sendPdfToWebView = useCallback(() => {
    if (isNativePdf) return;
    const payload = resolvedFileUri || resolvedBase64;
    if (!webViewRef.current || !payload) return;
    // Sending the same document twice is pure cost, and the load handlers below
    // deliberately fire more than once to cover slow WebView start-up
    if (deliveredRef.current === payload) return;
    deliveredRef.current = payload;

    // 1. Direct JS execution into the WebView (reliable across all Android webview versions)
    const script = `
      (function() {
        if (typeof window.renderPdf === 'function') {
          window.renderPdf(${JSON.stringify(payload)}, ${singlePageOnly});
        } else {
          window.__INITIAL_PDF__ = { base64: ${JSON.stringify(payload)}, singlePage: ${singlePageOnly} };
        }
      })();
      true;
    `;
    try {
      webViewRef.current.injectJavaScript(script);
    } catch (e) {}

    // 2. Second channel as a backup, but only for a path: repeating a whole
    // scan through postMessage doubles the cost of opening it
    if (!resolvedFileUri) return;
    try {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'LOAD_PDF',
          base64: payload,
          singlePage: singlePageOnly,
        })
      );
    } catch (e) {}
  }, [resolvedBase64, resolvedFileUri, singlePageOnly, isNativePdf]);

  // A different document has to be allowed through again
  useEffect(() => { deliveredRef.current = ''; }, [resolvedBase64, resolvedFileUri]);

  useEffect(() => {
    if (isViewerReady && (resolvedBase64 || resolvedFileUri)) {
      sendPdfToWebView();
    }
  }, [isViewerReady, resolvedBase64, resolvedFileUri, sendPdfToWebView]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'VIEWER_READY') {
        setIsViewerReady(true);
        sendPdfToWebView();
      }
    } catch (e) {}
  };

  const handleLoadEnd = () => {
    if (isNativePdf) return;
    sendPdfToWebView();
    setTimeout(sendPdfToWebView, 100);
    setTimeout(sendPdfToWebView, 300);
    setTimeout(sendPdfToWebView, 700);
  };

  const injectedInitScript = useMemo(() => {
    if (isNativePdf) return undefined;
    const payload = resolvedFileUri || resolvedBase64;
    if (!payload) return undefined;
    return `
      window.__INITIAL_PDF__ = { base64: ${JSON.stringify(payload)}, singlePage: ${singlePageOnly} };
      true;
    `;
  }, [resolvedBase64, resolvedFileUri, singlePageOnly, isNativePdf]);

  if (resolveError) {
    return (
      <View style={[styles.container, styles.centered, style]} pointerEvents={pointerEvents}>
        <Text style={styles.message}>{resolveError}</Text>
      </View>
    );
  }

  // iOS: hand the file straight to WKWebView, which has a PDF renderer built in
  if (isNativePdf) {
    if (!resolvedFileUri) {
      return (
        <View style={[styles.container, styles.centered, style]} pointerEvents={pointerEvents}>
          <ActivityIndicator size="small" color="#0284c7" />
        </View>
      );
    }
    return (
      <View style={[styles.container, style]} pointerEvents={pointerEvents}>
        <WebView
          key={resolvedFileUri}
          originWhitelist={['*']}
          source={{ uri: resolvedFileUri }}
          allowingReadAccessToURL={READ_ACCESS_ROOT}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          javaScriptEnabled
          style={styles.webview}
          scrollEnabled={!singlePageOnly}
          showsVerticalScrollIndicator={!singlePageOnly}
          showsHorizontalScrollIndicator={!singlePageOnly}
          setSupportMultipleWindows={false}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, style]} pointerEvents={pointerEvents}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ uri: 'file:///android_asset/pdfjs/viewer.html' }}
        injectedJavaScriptBeforeContentLoaded={injectedInitScript}
        style={styles.webview}
        scrollEnabled={!singlePageOnly}
        nestedScrollEnabled={!singlePageOnly}
        allowFileAccess={true}
        allowFileAccessFromFileURLs={true}
        allowUniversalAccessFromFileURLs={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        webviewDebuggingEnabled={true}
        scalesPageToFit={true}
        setSupportMultipleWindows={false}
        showsVerticalScrollIndicator={!singlePageOnly}
        showsHorizontalScrollIndicator={!singlePageOnly}
        mixedContentMode="always"
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    fontSize: 13,
    color: '#b91c1c',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  webview: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
});
