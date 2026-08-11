import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatabaseHelper } from './DatabaseHelper';

const FAILED_ATTEMPTS_KEY = '@ewallet_failed_pin_attempts';
const LOCKOUT_UNTIL_KEY = '@ewallet_pin_lockout_until';

export interface LockoutState {
  failedAttempts: number;
  lockoutUntil: number;
  remainingSeconds: number;
}

export class LockoutService {
  private static async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
      return await AsyncStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  private static async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
        return;
      }
      await AsyncStorage.setItem(key, value);
    } catch (e) {}
  }

  private static async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
        return;
      }
      await AsyncStorage.removeItem(key);
    } catch (e) {}
  }

  static async getLockoutState(): Promise<LockoutState> {
    const attemptsStr = await this.getItem(FAILED_ATTEMPTS_KEY);
    const lockoutStr = await this.getItem(LOCKOUT_UNTIL_KEY);

    const failedAttempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;
    const lockoutUntil = lockoutStr ? parseInt(lockoutStr, 10) : 0;

    const now = Date.now();
    const remainingMs = Math.max(0, lockoutUntil - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    return {
      failedAttempts,
      lockoutUntil,
      remainingSeconds,
    };
  }

  static async recordFailedAttempt(): Promise<{ state: LockoutState; isWiped: boolean }> {
    const currentState = await this.getLockoutState();
    const newAttempts = currentState.failedAttempts + 1;
    let newLockoutUntil = 0;
    let isWiped = false;

    if (newAttempts >= 6) {
      // 6th Failed Attempt -> Wipe all data & reset app
      await DatabaseHelper.clearAllData();
      await this.resetLockoutState();
      isWiped = true;
      return {
        state: { failedAttempts: 0, lockoutUntil: 0, remainingSeconds: 0 },
        isWiped: true,
      };
    } else if (newAttempts === 3) {
      // 3rd Failed Attempt -> 30 seconds lockout
      newLockoutUntil = Date.now() + 30 * 1000;
    } else if (newAttempts === 5) {
      // 5th Failed Attempt -> 5 minutes lockout
      newLockoutUntil = Date.now() + 5 * 60 * 1000;
    }

    await this.setItem(FAILED_ATTEMPTS_KEY, newAttempts.toString());
    if (newLockoutUntil > 0) {
      await this.setItem(LOCKOUT_UNTIL_KEY, newLockoutUntil.toString());
    }

    const remainingSeconds = Math.ceil(Math.max(0, newLockoutUntil - Date.now()) / 1000);

    return {
      state: {
        failedAttempts: newAttempts,
        lockoutUntil: newLockoutUntil,
        remainingSeconds,
      },
      isWiped: false,
    };
  }

  static async resetLockoutState(): Promise<void> {
    await this.removeItem(FAILED_ATTEMPTS_KEY);
    await this.removeItem(LOCKOUT_UNTIL_KEY);
  }
}
