const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add 'wasm' to asset extensions so Expo SQLite can bundle it for the web
config.resolver.assetExts.push('wasm');

// Expo SQLite on the web runs in a worker over SharedArrayBuffer, which the
// browser only provides to a cross-origin isolated page. Without these headers
// the database never opens and registering a vault silently does nothing.
// Isolation is also limited to secure origins: localhost or https, not a
// plain-http LAN address.
//
// server.enhanceMiddleware is not enough: the Expo CLI serves index.html from
// middleware it prepends ahead of Metro's, and the opener policy has to be on
// that document. Every response of the dev server passes through writeHead
// (res.end calls it implicitly), so the headers are added there. Only the dev
// server answers HTTP requests; bundling for a native build never does.
const http = require('http');
const originalWriteHead = http.ServerResponse.prototype.writeHead;
if (!originalWriteHead.__offlineLockerIsolation) {
  http.ServerResponse.prototype.writeHead = function writeHead(...args) {
    if (!this.headersSent && !this.hasHeader('Cross-Origin-Opener-Policy')) {
      this.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      this.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    }
    return originalWriteHead.apply(this, args);
  };
  http.ServerResponse.prototype.writeHead.__offlineLockerIsolation = true;
}

// The pdf.js copies under assets/pdfjs are shipped as data, not as modules:
// iOS has no android_asset directory to read them from, and the app has no
// network to fetch them over, so they travel in the bundle and are unpacked
// to the cache at runtime. The extension keeps Metro from treating them as
// source it should transform.
config.resolver.assetExts.push('pdfjsasset');

module.exports = config;
