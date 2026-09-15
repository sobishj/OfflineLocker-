import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { View, Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';

interface PdfViewerProps {
  uri: string;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
  singlePageOnly?: boolean;
}

export default function PdfViewer({
  uri,
  style,
  pointerEvents = 'auto',
  singlePageOnly = false,
}: PdfViewerProps) {
  const webViewRef = useRef<WebView>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [resolvedBase64, setResolvedBase64] = useState<string>('');

  // Resolve uri to pure base64 (handling file:// disk paths, data URIs, or raw base64)
  useEffect(() => {
    let isMounted = true;

    async function resolveData() {
      if (!uri) {
        if (isMounted) setResolvedBase64('');
        return;
      }

      if (uri.startsWith('file://')) {
        try {
          const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
          if (isMounted) setResolvedBase64(b64.replace(/[\r\n\s]/g, '').trim());
          return;
        } catch (err) {
          console.warn('PdfViewer FileSystem read error:', err);
        }
      }

      const raw = uri.includes('base64,') ? uri.split('base64,')[1] : uri;
      const clean = raw.replace(/[\r\n\s]/g, '').trim();
      if (isMounted) setResolvedBase64(clean);
    }

    resolveData();
    return () => {
      isMounted = false;
    };
  }, [uri]);

  const sendPdfToWebView = useCallback(() => {
    if (!webViewRef.current || !resolvedBase64) return;

    // 1. Direct JS execution into the WebView (reliable across all Android webview versions)
    const script = `
      (function() {
        if (typeof window.renderPdf === 'function') {
          window.renderPdf(${JSON.stringify(resolvedBase64)}, ${singlePageOnly});
        } else {
          window.__INITIAL_PDF__ = { base64: ${JSON.stringify(resolvedBase64)}, singlePage: ${singlePageOnly} };
        }
      })();
      true;
    `;
    try {
      webViewRef.current.injectJavaScript(script);
    } catch (e) {}

    // 2. Dual-channel delivery via postMessage as backup
    try {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'LOAD_PDF',
          base64: resolvedBase64,
          singlePage: singlePageOnly,
        })
      );
    } catch (e) {}
  }, [resolvedBase64, singlePageOnly]);

  useEffect(() => {
    if (isViewerReady && resolvedBase64) {
      sendPdfToWebView();
    }
  }, [isViewerReady, resolvedBase64, sendPdfToWebView]);

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
    sendPdfToWebView();
    setTimeout(sendPdfToWebView, 100);
    setTimeout(sendPdfToWebView, 300);
    setTimeout(sendPdfToWebView, 700);
  };

  const injectedInitScript = useMemo(() => {
    if (!resolvedBase64) return undefined;
    return `
      window.__INITIAL_PDF__ = { base64: ${JSON.stringify(resolvedBase64)}, singlePage: ${singlePageOnly} };
      true;
    `;
  }, [resolvedBase64, singlePageOnly]);

  // Fallback HTML for non-Android platforms (iOS / Web)
  const fallbackHtmlSource = useMemo(() => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=0.5, maximum-scale=5.0, user-scalable=yes">
  <title>PDF Viewer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      min-height: 100%;
      background-color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      touch-action: pan-x pan-y pinch-zoom;
    }
    #viewer-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      padding: 10px 6px 60px 6px;
      transform-origin: top center;
      transition: transform 0.1s ease-out;
    }
    .page-wrapper {
      width: 100%;
      max-width: 100%;
      margin-bottom: 12px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    canvas {
      display: block;
      max-width: 100%;
      height: auto !important;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      background-color: #ffffff;
    }
    #loading-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 16px;
      color: #64748b;
      font-size: 14px;
      font-weight: 500;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #e2e8f0;
      border-top-color: #0284c7;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 12px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #error-box {
      display: none;
      padding: 14px;
      margin: 14px;
      border-radius: 8px;
      background: #fef2f2;
      border: 1px solid #fee2e2;
      color: #b91c1c;
      font-size: 13px;
      text-align: center;
      word-break: break-word;
    }
    #zoom-toolbar {
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: none;
      flex-direction: row;
      align-items: center;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      padding: 4px 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 9999;
    }
    .zoom-btn {
      background: transparent;
      border: none;
      color: #ffffff;
      font-size: 18px;
      font-weight: 700;
      width: 32px;
      height: 32px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }
    .zoom-btn:active {
      background: rgba(255, 255, 255, 0.2);
    }
    .scale-btn {
      width: auto;
      padding: 0 8px;
      font-size: 12px;
      color: #38bdf8;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div id="loading-indicator">
    <div class="spinner"></div>
    <span>Loading PDF...</span>
  </div>
  <div id="error-box"></div>
  <div id="viewer-container"></div>
  <div id="zoom-toolbar">
    <button id="zoom-out-btn" class="zoom-btn" title="Zoom Out">-</button>
    <button id="zoom-reset-btn" class="zoom-btn scale-btn" title="Reset Zoom">100%</button>
    <button id="zoom-in-btn" class="zoom-btn" title="Zoom In">+</button>
  </div>

  <script>
    var currentScale = 1.0;
    var minScale = 0.8;
    var maxScale = 4.0;
    var isPinching = false;
    var initialPinchDist = 0;
    var initialPinchScale = 1.0;
    var lastTapTime = 0;

    function updateZoom(newScale) {
      currentScale = Math.min(Math.max(newScale, minScale), maxScale);
      var container = document.getElementById('viewer-container');
      if (container) {
        container.style.transform = 'scale(' + currentScale + ')';
      }
      var resetBtn = document.getElementById('zoom-reset-btn');
      if (resetBtn) {
        resetBtn.innerText = Math.round(currentScale * 100) + '%';
      }
    }

    document.getElementById('zoom-in-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      updateZoom(currentScale + 0.3);
    });

    document.getElementById('zoom-out-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      updateZoom(currentScale - 0.3);
    });

    document.getElementById('zoom-reset-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      updateZoom(1.0);
    });

    document.addEventListener('touchstart', function(e) {
      if (e.touches.length === 2) {
        isPinching = true;
        var dx = e.touches[0].pageX - e.touches[1].pageX;
        var dy = e.touches[0].pageY - e.touches[1].pageY;
        initialPinchDist = Math.hypot(dx, dy);
        initialPinchScale = currentScale;
      } else if (e.touches.length === 1) {
        var now = Date.now();
        if (now - lastTapTime < 300) {
          if (currentScale > 1.2) {
            updateZoom(1.0);
          } else {
            updateZoom(2.0);
          }
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
      }
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
      if (isPinching && e.touches.length === 2 && initialPinchDist > 0) {
        var dx = e.touches[0].pageX - e.touches[1].pageX;
        var dy = e.touches[0].pageY - e.touches[1].pageY;
        var dist = Math.hypot(dx, dy);
        var factor = dist / initialPinchDist;
        updateZoom(initialPinchScale * factor);
      }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      if (e.touches.length < 2) {
        isPinching = false;
        initialPinchDist = 0;
      }
    }, { passive: true });

    function showError(msg) {
      var loadingEl = document.getElementById('loading-indicator');
      if (loadingEl) loadingEl.style.display = 'none';
      var errEl = document.getElementById('error-box');
      if (errEl) {
        errEl.style.display = 'block';
        errEl.innerText = msg;
      }
    }

    window.onerror = function(msg, url, lineNo, colNo, error) {
      showError('Script Error: ' + msg);
    };

    function base64ToUint8Array(base64) {
      if (base64 instanceof Uint8Array) return base64;
      if (base64 instanceof ArrayBuffer) return new Uint8Array(base64);
      var clean = String(base64)
        .replace(/^data:[^;]+;base64,/, '')
        .replace(/[\\r\\n\\s]/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      while (clean.length % 4) { clean += '='; }
      var raw = window.atob(clean);
      var rawLength = raw.length;
      var array = new Uint8Array(new ArrayBuffer(rawLength));
      for (var i = 0; i < rawLength; i++) {
        array[i] = raw.charCodeAt(i);
      }
      return array;
    }

    function renderPdf(inputData, singlePage) {
      if (!inputData) return;
      var loadingEl = document.getElementById('loading-indicator');
      if (loadingEl) loadingEl.style.display = 'flex';
      var errEl = document.getElementById('error-box');
      if (errEl) errEl.style.display = 'none';
      var container = document.getElementById('viewer-container');
      if (container) {
        container.innerHTML = '';
        container.style.transform = 'scale(1.0)';
        currentScale = 1.0;
      }

      var toolbar = document.getElementById('zoom-toolbar');
      if (toolbar) {
        toolbar.style.display = singlePage ? 'none' : 'flex';
      }

      try {
        var docParam;
        if (typeof inputData === 'string' && (inputData.startsWith('file://') || inputData.startsWith('http://') || inputData.startsWith('https://'))) {
          docParam = { url: inputData, disableAutoFetch: true, disableStream: true };
        } else {
          var pdfBytes = base64ToUint8Array(inputData);
          docParam = { data: pdfBytes, disableAutoFetch: true, disableStream: true };
        }

        pdfjsLib.getDocument(docParam).promise.then(function(pdf) {
          if (loadingEl) loadingEl.style.display = 'none';
          var totalPages = singlePage ? 1 : pdf.numPages;

          for (var pageNum = 1; pageNum <= totalPages; pageNum++) {
            (function(num) {
              var pageWrapper = document.createElement('div');
              pageWrapper.className = 'page-wrapper';
              var canvas = document.createElement('canvas');
              pageWrapper.appendChild(canvas);
              container.appendChild(pageWrapper);

              pdf.getPage(num).then(function(page) {
                var dpr = window.devicePixelRatio || 2;
                var containerWidth = container.clientWidth || window.innerWidth || 360;
                var unscaledViewport = page.getViewport({ scale: 1 });
                var fitScale = (containerWidth / unscaledViewport.width) * dpr;

                var viewport = page.getViewport({ scale: fitScale });
                var context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                page.render({
                  canvasContext: context,
                  viewport: viewport,
                });
              }).catch(function(pErr) {
                console.error('Page render error:', pErr);
              });
            })(pageNum);
          }
        }).catch(function(err) {
          showError('Failed to parse PDF: ' + (err.message || err));
        });
      } catch (e) {
        showError('Failed to process PDF: ' + (e.message || e));
      }
    }

    window.renderPdf = renderPdf;

    function handleMessage(event) {
      try {
        var rawData = event.data;
        var msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
        if (msg && msg.type === 'LOAD_PDF') {
          var dataToLoad = msg.base64 || msg.uri || msg.data;
          renderPdf(dataToLoad, msg.singlePage);
        }
      } catch (e) {}
    }

    window.addEventListener('message', handleMessage);
    document.addEventListener('message', handleMessage);

    function notifyReady() {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'VIEWER_READY' }));
      }
    }
    window.addEventListener('load', notifyReady);
    setTimeout(notifyReady, 100);

    if (window.__INITIAL_PDF__) {
      var initialData = window.__INITIAL_PDF__.base64 || window.__INITIAL_PDF__.uri || window.__INITIAL_PDF__.data;
      renderPdf(initialData, window.__INITIAL_PDF__.singlePage);
      window.__INITIAL_PDF__ = null;
    }
  </script>
</body>
</html>
    `;
  }, []);

  return (
    <View style={[styles.container, style]} pointerEvents={pointerEvents}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={
          Platform.OS === 'android'
            ? { uri: 'file:///android_asset/pdfjs/viewer.html' }
            : { html: fallbackHtmlSource }
        }
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
  webview: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
});
