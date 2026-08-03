# eWallet Mobile Application (Flutter for Android & iOS)

A feature-rich, secure, cross-platform mobile eWallet built with **Flutter**. This application replicates and expands upon the Svelte web eWallet, offering native performance, hardware encryption, camera receipt scanning, and sleek dark mode glassmorphism UI for both Android and iOS devices.

## 🚀 Features
- **Biometric & PIN Authentication**: Secure login and registration with PIN hashing.
- **Custom Vault Tabs & Secondary PINs**: Create tabs with custom budgets. Protect sensitive vault tabs with an additional 4-6 digit PIN.
- **Hardware-Grade Encryption**: Uses AES-256 (via `encrypt` and `crypto` packages) to encrypt document payloads and private notes before saving to SQLite.
- **Camera Document & Receipt Scanner**: Take pictures of receipts or documents directly using the phone's camera, encrypting them on the fly.
- **Offline First & Local Storage**: Uses `sqflite` for structured data and `flutter_secure_storage` for cryptographic keys.
- **Backup & Restore**: Export encrypted JSON backups to local storage or share via email/cloud.

## 🛠️ Prerequisites & Setup
Since this is a Flutter mobile application, you must have the **Flutter SDK** installed on your system to build and run the app on Android emulators, iOS simulators, or physical devices.

### 1. Install Flutter SDK
- **Windows**: Download the Flutter SDK from [flutter.dev](https://docs.flutter.dev/get-started/install/windows) or install via winget:
  ```powershell
  winget install -e --id Flutter.Flutter
  ```
- **macOS / Linux**: Follow official installation guides at flutter.dev.

### 2. Verify Environment
Run the following command in your terminal to ensure Android Studio / Xcode toolchains are configured:
```bash
flutter doctor
```

### 3. Install Dependencies
Navigate to this directory and install required Dart/Flutter packages:
```bash
cd c:\AntiGravity\eWallet\ewallet_flutter
flutter pub get
```

### 4. Run the Application
To run on a connected Android device, iOS simulator, or Windows desktop:
```bash
flutter run
```
To run specifically for Android or iOS:
```bash
flutter run -d android
# or for iOS (macOS required)
flutter run -d ios
```
