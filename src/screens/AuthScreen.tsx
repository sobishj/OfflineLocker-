import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { AppTheme } from '../theme/AppTheme';

export default function AuthScreen() {
  const { currentUser, registerUser, loginUser, errorMessage, clearError } = useWalletStore();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const isRegistration = !currentUser;

  const handleSubmit = async () => {
    clearError();
    if (isRegistration) {
      const success = await registerUser(username, pin);
      if (success) {
        Alert.alert('Success', 'Registered successfully. Please login.');
      }
    } else {
      await loginUser(pin);
    }
    setPin(''); // clear PIN on fail
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>{isRegistration ? 'Create Vault' : 'Unlock Vault'}</Text>
        
        {isRegistration && (
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={AppTheme.colors.textSecondary}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        )}
        
        <TextInput
          style={styles.input}
          placeholder="4-Digit PIN"
          placeholderTextColor={AppTheme.colors.textSecondary}
          value={pin}
          onChangeText={setPin}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={handleSubmit}>
          <Text style={styles.buttonText}>{isRegistration ? 'Register' : 'Login'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppTheme.colors.background,
    justifyContent: 'center',
    padding: AppTheme.spacing.l,
  },
  content: {
    backgroundColor: AppTheme.colors.surface,
    padding: AppTheme.spacing.l,
    borderRadius: AppTheme.borderRadius.l,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    color: AppTheme.colors.text,
    fontWeight: 'bold',
    marginBottom: AppTheme.spacing.xl,
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: AppTheme.colors.background,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: AppTheme.borderRadius.m,
    paddingHorizontal: AppTheme.spacing.m,
    color: AppTheme.colors.text,
    marginBottom: AppTheme.spacing.m,
    fontSize: 16,
  },
  error: {
    color: AppTheme.colors.error,
    marginBottom: AppTheme.spacing.m,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: AppTheme.colors.primary,
    borderRadius: AppTheme.borderRadius.m,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: AppTheme.spacing.m,
  },
  buttonText: {
    color: AppTheme.colors.background,
    fontSize: 18,
    fontWeight: 'bold',
  },
});
