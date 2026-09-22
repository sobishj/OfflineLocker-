import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useLockerStore } from './src/store/useLockerStore';
import AuthScreen from './src/screens/AuthScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import TabDetailScreen from './src/screens/TabDetailScreen';
import { ActivityIndicator, View, StatusBar, AppState } from 'react-native';
import { AppTheme } from './src/theme/AppTheme';
import { isAutoLockSuppressed } from './src/services/AutoLockService';

import { SafeAreaProvider } from 'react-native-safe-area-context';

const Stack = createNativeStackNavigator();

export default function App() {
  const { isLoading, isAuthenticated, checkExistingUsers } = useLockerStore();

  useEffect(() => {
    checkExistingUsers();
  }, []);

  useEffect(() => {
    // Switching away hands the screen to another app, so the vault closes
    // behind us and the PIN is needed again. Reading the store at the moment
    // of the event keeps this listener out of the render cycle.
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'background' && next !== 'inactive') return;
      if (isAutoLockSuppressed()) return;
      const state = useLockerStore.getState();
      if (state.isAuthenticated) state.logout();
    });
    return () => subscription.remove();
  }, []);

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
        <StatusBar barStyle="dark-content" backgroundColor={AppTheme.colors.background} />
        <Stack.Navigator screenOptions={{ 
          headerStyle: { backgroundColor: AppTheme.colors.surface },
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
    </SafeAreaProvider>
  );
}
