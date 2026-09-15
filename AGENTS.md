# Expo Documentation

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Android APK Build & Release Protocol

Whenever generating an APK file, always follow these steps:
1. **Version Bump**:
   - Increment `versionCode` and update `version` in both `app.json` and `android/app/build.gradle`.
2. **Build Release APK**:
   - Run `.\gradlew.bat assembleRelease` inside the `android/` directory.
3. **Verify Signing**:
   - Ensure the output `android/app/build/outputs/apk/release/app-release.apk` is signed with `release.keystore` (verifiable via `apksigner verify -v`).
4. **Copy to Root Distribution File**:
   - Always copy the newly built APK to the root directory as `OfflineLocker.apk`:
     ```powershell
     Copy-Item "android\app\build\outputs\apk\release\app-release.apk" -Destination "OfflineLocker.apk" -Force
     ```
5. **Serve for Local Wi-Fi Installation**:
   - Ensure the local HTTP distribution server is active (`python -m http.server 8000 --bind 0.0.0.0`) so the user can download and test immediately via `http://<LAN-IP>:8000/OfflineLocker.apk` or `qr.html`.
6. **Installation Notice**:
   - Remind the user that if Android prompts "App was not installed", any prior installation of OfflineLocker must be uninstalled first due to Android OS-level certificate/signature enforcement.

