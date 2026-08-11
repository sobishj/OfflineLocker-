import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useWalletStore } from './src/store/useWalletStore';
import AuthScreen from './src/screens/AuthScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import TabDetailScreen from './src/screens/TabDetailScreen';
import { ActivityIndicator, View, StatusBar } from 'react-native';
import { AppTheme } from './src/theme/AppTheme';

const Stack = createNativeStackNavigator();

export default function App() {
  const { isLoading, isAuthenticated, checkExistingUsers } = useWalletStore();

  useEffect(() => {
    checkExistingUsers();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: AppTheme.colors.background }}>
        <ActivityIndicator size="large" color={AppTheme.colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" />
      <Stack.Navigator screenOptions={{ 
        headerStyle: { backgroundColor: AppTheme.colors.surface },
        headerTintColor: AppTheme.colors.text,
        headerBackTitle: '',
        contentStyle: { backgroundColor: AppTheme.colors.background }
      }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'eWallet Vault' }} />
            <Stack.Screen 
              name="TabDetail" 
              component={TabDetailScreen} 
              options={({ route }: any) => ({ 
                title: route.params.tabName,
                headerBackTitle: ''
              })} 
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
