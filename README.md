# OfflineLocker Mobile Application

A feature-rich, secure, cross-platform OfflineLocker built with React Native and Expo for Android, iOS, and web.

## 🚀 Features
- **Biometric & PIN Authentication**: Secure login and registration with PIN hashing.
- **Custom Vault Tabs & Secondary PINs**: Create tabs with custom budgets. Protect sensitive vault tabs with an additional 4-6 digit PIN.
- **Hardware-Grade Encryption**: Uses AES-256 (via `encrypt` and `crypto` packages) to encrypt document payloads and private notes before saving to SQLite.
- **Camera Document & Receipt Scanner**: Take pictures of receipts or documents directly using the phone's camera, encrypting them on the fly.
- **Offline First & Local Storage**: Uses `expo-sqlite` for structured data and `@react-native-async-storage/async-storage` for cryptographic keys.
- **Backup & Restore**: Export encrypted JSON backups to local storage or share via email/cloud.

## 🛠️ Prerequisites & Setup
Since this is a React Native + Expo mobile application, you must have **Node.js** and the **Expo CLI** installed on your system to build and run the app on Android emulators, iOS simulators, or physical devices.

### 1. Install Node.js
- **Windows**: Download from [nodejs.org](https://nodejs.org/) or install via winget:
  ```powershell
  winget install -e --id OpenJS.NodeJS
  ```
- **macOS / Linux**: Follow official installation guides at nodejs.org.

### 2. Install Dependencies
Navigate to this directory and install required packages:
```bash
cd C:\VSCode\OfflineLocker
npm install
```

### 3. Run the Application
To start the Expo dev server:
```bash
npm start
```
To run on a specific platform:
```bash
npm run android
# or for iOS (macOS required)
npm run ios
# or for web
npm run web
```
