const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add 'wasm' to asset extensions so Expo SQLite can bundle it for the web
config.resolver.assetExts.push('wasm');

// The pdf.js copies under assets/pdfjs are shipped as data, not as modules:
// iOS has no android_asset directory to read them from, and the app has no
// network to fetch them over, so they travel in the bundle and are unpacked
// to the cache at runtime. The extension keeps Metro from treating them as
// source it should transform.
config.resolver.assetExts.push('pdfjsasset');

module.exports = config;
