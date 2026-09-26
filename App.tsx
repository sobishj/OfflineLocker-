import React, { useEffect } from 'react';
import { BackHandler, Keyboard, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useLockerStore } from './src/store/useLockerStore';
import AuthScreen from './src/screens/AuthScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import TabDetailScreen from './src/screens/TabDetailScreen';
import { ActivityIndicator, View, StatusBar, AppState } from 'react-native';
import { AppTheme } from './src/theme/AppTheme';
import { isAutoLockSuppressed } from './src/services/AutoLockService';
import { clearDecryptedCache } from './src/services/FileCacheService';

import { SafeAreaProvider } from 'react-native-safe-area-context';

const Stack = createNativeStackNavigator();

export default function App() {
  // themeVersion is read so that repainting the theme re-renders the whole
  // tree, which is what lets the screens pick up the new colours
  const { isLoading, isAuthenticated, isLocked, checkExistingUsers, loadAccent, themeVersion } = useLockerStore();

  useEffect(() => {
    const start = async () => {
      // A lock keeps the session, files written out for the viewer included,
      // so an app closed while locked can leave some behind; a fresh start
      // clears them before anything else
      await clearDecryptedCache();
      // Before checkExistingUsers, which is what clears the loading screen: the
      // lock screen should already be in the right colour rather than flick
      await loadAccent();
      await checkExistingUsers();
    };
    start();
  }, []);

  useEffect(() => {
    // Switching away hands the screen to another app, so the PIN is needed
    // again on the way back. The session itself is kept under the lock screen,
    // so the same tab, file or note is there after unlocking; only closing the
    // app for good starts again from the beginning. Reading the store at the
    // moment of the event keeps this listener out of the render cycle.
    const subscription = AppState.addEventListener('change', next => {
      // 'background' only. iOS also reports 'inactive' for the control centre,
      // the app switcher and system permission sheets, none of which mean the
      // user has left; locking on those would throw away what they were doing.
      if (next !== 'background') return;
      if (isAutoLockSuppressed()) return;
      const state = useLockerStore.getState();
      if (state.isAuthenticated) {
        Keyboard.dismiss();
        state.lockSession();
      }
    });
    return () => subscription.remove();
  }, []);

  // Android's back button would otherwise go back through the screens hidden
  // under the lock
  useEffect(() => {
    if (!isLocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [isLocked]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: AppTheme.colors.background }}>
        <ActivityIndicator size="large" color={AppTheme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar barStyle="dark-content" backgroundColor={AppTheme.colors.bar} />
        <Stack.Navigator screenOptions={{ 
          headerStyle: { backgroundColor: AppTheme.colors.bar },
          headerTintColor: AppTheme.colors.text,
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: AppTheme.colors.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: AppTheme.colors.background }
        }}>
          {!isAuthenticated ? (
            <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
          ) : (
            <>
              <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'OfflineLocker' }} />
              <Stack.Screen 
                name="TabDetail" 
                component={TabDetailScreen} 
                options={{ headerShown: false }} 
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {/* The lock sits over the kept session rather than replacing it */}
      {isAuthenticated && isLocked && (
        <View style={StyleSheet.absoluteFill}>
          <AuthScreen />
        </View>
      )}
    </SafeAreaProvider>
  );
}
