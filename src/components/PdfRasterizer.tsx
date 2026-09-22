import React, { useCallback, useMemo, useRef } from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface PdfRasterizerProps {
  /** Base64 of the PDF, without the `data:` prefix. Only used when the file
   *  cannot be read from disk: it has to be streamed in chunks, because a whole
   *  scan injected as one JS string overflows the evaluateJavascript limit. */
  base64: string;
  /** The same PDF on disk. When it can be read from there the base64 is never
   *  sent at all, which for a large scan saves hundreds of round trips. */
  fileUri?: string;
  /** Receives a JPEG data URI of page 1, or '' when rendering failed. */
  onResult: (imageDataUri: string) => void;
}

/** 60 KB per injectJavaScript call keeps every chunk well inside the limit. */
const CHUNK_SIZE = 61440;

/**
 * Renders page 1 of a PDF to an image offscreen so it can be passed to OCR.
 * Android uses the pdf.js copy bundled in assets, so it works with no network.
 */
export default function PdfRasterizer({ base64, fileUri, onResult }: PdfRasterizerProps) {
  const webRef = useRef<WebView>(null);
  const doneRef = useRef(false);

  const html = useMemo(() => {
    const scriptTags = Platform.OS === 'android'
      ? '<script src="pdf.min.js"></script>'
      : '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0">
${scriptTags}
<script>
  function post(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }

  window.__PARTS__ = [];
  window.__PUSH__ = function (part) { window.__PARTS__.push(part); };

  function setWorker() {
    ${Platform.OS === 'android'
      ? "window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';"
      : "window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';"}
  }

  /** Reads the PDF straight off disk. pdf.js will not do this itself: its own
   *  transport only accepts status 200/206, and a local file read reports 0. */
  window.__LOAD_FILE__ = function (url) {
    try {
      if (!window.pdfjsLib) { post({ ok: false, error: 'pdfjs missing' }); return; }
      setWorker();
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (xhr.response && xhr.response.byteLength > 0) {
          render(new Uint8Array(xhr.response));
        } else {
          post({ ok: false, error: 'empty file read', needsChunks: true });
        }
      };
      xhr.onerror = function () { post({ ok: false, error: 'file read failed', needsChunks: true }); };
      xhr.send();
    } catch (err) {
      post({ ok: false, error: String(err), needsChunks: true });
    }
  };

  window.__RUN__ = function () {
    try {
      if (!window.pdfjsLib) { post({ ok: false, error: 'pdfjs missing' }); return; }
      setWorker();

      var b64 = window.__PARTS__.join('');
      window.__PARTS__ = [];
      if (!b64) { post({ ok: false, error: 'no pdf data received' }); return; }

      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      render(bytes);
    } catch (err) {
      post({ ok: false, error: String(err) });
    }
  };

  function render(bytes) {
    try {
      window.pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
        return pdf.getPage(1);
      }).then(function (page) {
        // Upscale a little: OCR is far more accurate on a larger raster
        var viewport = page.getViewport({ scale: 2.0 });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var ctx = canvas.getContext('2d');
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
          post({ ok: true, image: canvas.toDataURL('image/jpeg', 0.92) });
        });
      }).catch(function (err) {
        post({ ok: false, error: String(err) });
      });
    } catch (err) {
      post({ ok: false, error: String(err) });
    }
  }
</script>
</body></html>`;
  }, []);

  /** The fallback: streams the base64 across a chunk at a time. */
  const sendChunks = useCallback(() => {
    const web = webRef.current;
    if (!web) return;
    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
      web.injectJavaScript(`window.__PUSH__(${JSON.stringify(base64.slice(i, i + CHUNK_SIZE))}); true;`);
    }
    web.injectJavaScript('window.__RUN__(); true;');
  }, [base64]);

  /** Points the page at the file once it (and pdf.js) has loaded. */
  const sendPdf = useCallback(() => {
    const web = webRef.current;
    if (!web || doneRef.current) return;
    doneRef.current = true;

    if (fileUri) {
      web.injectJavaScript(`window.__LOAD_FILE__(${JSON.stringify(fileUri)}); true;`);
      return;
    }
    sendChunks();
  }, [base64, fileUri, sendChunks]);

  return (
    <View style={styles.offscreen} pointerEvents="none">
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: Platform.OS === 'android' ? 'file:///android_asset/pdfjs/' : '' }}
        javaScriptEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onLoadEnd={sendPdf}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data);
            if (payload?.needsChunks) {
              // The file could not be read from the page, so fall back to
              // handing the bytes over the way this always used to
              sendChunks();
              return;
            }
            if (!payload?.ok) console.warn('PDF rasterize failed:', payload?.error);
            onResult(payload?.ok && payload.image ? payload.image : '');
          } catch (e) {
            onResult('');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -9999,
    top: -9999,
  },
});
