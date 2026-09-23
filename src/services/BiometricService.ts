import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { withoutAutoLock } from './AutoLockService';

/**
 * Fingerprint / Face ID as a stand-in for typing a PIN.
 *
 * Every PIN in the app is an access gate: the data underneath is encrypted
 * with the account key, not with the PIN. A successful scan can therefore
 * simply take the place of the PIN check. The one exception is a sensitive
 * tab, whose older documents were encrypted with the tab PIN itself, so for
 * tabs the PIN is kept in the keychain / keystore and handed back after the
 * scan.
 *
 * Whether a PIN may be skipped is a property of this device, not of the vault,
 * so the switches live in SecureStore rather than in the database - a backup
 * restored elsewhere does not arrive with biometrics already turned on.
 */

export type BiometricScope = string;

export const BiometricScopes = {
  app: 'app' as BiometricScope,
  diary: 'diary' as BiometricScope,
  tab: (uuid: string): BiometricScope => `tab.${uuid}`,
  note: (id: number): BiometricScope => `note.${id}`,
};

export interface BiometricSupport {
  available: boolean;
  /** What to call it in a sentence: "Face ID", "Touch ID", "fingerprint", "biometrics". */
  label: string;
  icon: 'scan-outline' | 'finger-print';
}

const UNSUPPORTED: BiometricSupport = { available: false, label: 'biometrics', icon: 'finger-print' };

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** SecureStore keys may only hold letters, digits, '.', '-' and '_'. */
const keyFor = (userId: string, scope: BiometricScope) =>
  `olbio.${userId}.${scope}`.replace(/[^A-Za-z0-9._-]/g, '_');

/** SecureStore cannot list its keys, so each user's scopes are recorded to allow a full clear. */
const indexKey = (userId: string) => keyFor(userId, '_index');

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

let supportCache: Promise<BiometricSupport> | null = null;

const readIndex = async (userId: string): Promise<BiometricScope[]> => {
  try {
    const raw = await SecureStore.getItemAsync(indexKey(userId), STORE_OPTIONS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeIndex = async (userId: string, scopes: BiometricScope[]) => {
  try {
    if (scopes.length === 0) await SecureStore.deleteItemAsync(indexKey(userId), STORE_OPTIONS);
    else await SecureStore.setItemAsync(indexKey(userId), JSON.stringify(scopes), STORE_OPTIONS);
  } catch {
    // The index only serves clearAll; losing it leaves harmless orphans
  }
};

export const BiometricService = {
  /** Whether this device has a sensor with something enrolled on it. */
  getSupport(refresh = false): Promise<BiometricSupport> {
    if (!isNative) return Promise.resolve(UNSUPPORTED);
    if (supportCache && !refresh) return supportCache;
    supportCache = (async () => {
      try {
        const [hasHardware, isEnrolled, types] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
        ]);
        if (!hasHardware || !isEnrolled) return UNSUPPORTED;
        const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        if (Platform.OS === 'ios') {
          return face
            ? { available: true, label: 'Face ID', icon: 'scan-outline' }
            : { available: true, label: 'Touch ID', icon: 'finger-print' };
        }
        return finger && !face
          ? { available: true, label: 'fingerprint', icon: 'finger-print' }
          : { available: true, label: 'biometrics', icon: 'finger-print' };
      } catch {
        return UNSUPPORTED;
      }
    })();
    return supportCache;
  },

  /**
   * Shows the system prompt. Cancelling, a failed match, a sensor lockout or
   * removed enrolments all come back as false, and the caller asks for the PIN.
   */
  async authenticate(promptMessage: string): Promise<boolean> {
    if (!isNative) return false;
    const support = await this.getSupport(true);
    if (!support.available) return false;
    try {
      const result = await withoutAutoLock(() =>
        LocalAuthentication.authenticateAsync({
          promptMessage,
          cancelLabel: 'Use PIN',
          // The fallback is the app's own PIN, never the phone's passcode
          disableDeviceFallback: true,
          fallbackLabel: '',
        })
      );
      return result.success;
    } catch {
      return false;
    }
  },

  async isEnabled(userId: string | undefined, scope: BiometricScope): Promise<boolean> {
    if (!isNative || !userId) return false;
    try {
      return !!(await SecureStore.getItemAsync(keyFor(userId, scope), STORE_OPTIONS));
    } catch {
      // Keystore entries restored by Android backup cannot be decrypted
      return false;
    }
  },

  /** `secret` is what `unlock` hands back; scopes that are only gates keep '1'. */
  async enable(userId: string, scope: BiometricScope, secret = '1'): Promise<void> {
    if (!isNative) return;
    try {
      await SecureStore.setItemAsync(keyFor(userId, scope), secret, STORE_OPTIONS);
      const scopes = await readIndex(userId);
      if (!scopes.includes(scope)) await writeIndex(userId, [...scopes, scope]);
    } catch (error) {
      console.warn('Could not enable biometric unlock', error);
    }
  },

  async disable(userId: string | undefined, scope: BiometricScope): Promise<void> {
    if (!isNative || !userId) return;
    try {
      await SecureStore.deleteItemAsync(keyFor(userId, scope), STORE_OPTIONS);
    } catch {
      // Already gone
    }
    const scopes = await readIndex(userId);
    if (scopes.includes(scope)) await writeIndex(userId, scopes.filter(s => s !== scope));
  },

  /** Turns everything off for a user, for a new registration or a wipe. */
  async clearAll(userId: string | undefined): Promise<void> {
    if (!isNative || !userId) return;
    const scopes = await readIndex(userId);
    for (const scope of scopes) {
      try {
        await SecureStore.deleteItemAsync(keyFor(userId, scope), STORE_OPTIONS);
      } catch {
        // Keep clearing the rest
      }
    }
    await writeIndex(userId, []);
  },

  /**
   * Biometrics first: returns the stored secret after a successful scan, or
   * null when it is off, unavailable, cancelled or failed.
   */
  async unlock(userId: string | undefined, scope: BiometricScope, promptMessage: string): Promise<string | null> {
    if (!(await this.isEnabled(userId, scope))) return null;
    if (!(await this.authenticate(promptMessage))) return null;
    try {
      return await SecureStore.getItemAsync(keyFor(userId!, scope), STORE_OPTIONS);
    } catch {
      return null;
    }
  },
};
