import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { Feather } from '@expo/vector-icons';

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
        setPin('');
      }
    } else {
      const success = await loginUser(pin);
      if (!success) {
        setPin('');
      }
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Feather name="lock" size={24} color="#86868b" />
        </View>
        <Text style={styles.title}>{isRegistration ? 'Create Vault' : 'Unlock Vault'}</Text>
        <Text style={styles.subtitle}>
          {isRegistration ? 'Enter a username and 4-digit PIN' : 'Enter your 4-digit PIN to continue'}
        </Text>
        
        {isRegistration && (
          <TextInput
            style={[styles.input, { letterSpacing: 0, textAlign: 'left', fontSize: 16 }]}
            placeholder="Username"
            placeholderTextColor="#8e8e93"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        )}
        
        <TextInput
          style={[styles.input, { letterSpacing: pin ? 8 : 0, textAlign: pin ? 'center' : 'left', fontSize: pin ? 20 : 16 }]}
          placeholder="Enter 4-Digit PIN"
          placeholderTextColor="#8e8e93"
          value={pin}
          onChangeText={setPin}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {(() => {
          const isValid = isRegistration ? (username.trim().length > 0 && pin.trim().length === 4) : (pin.trim().length === 4);
          return (
            <TouchableOpacity 
              style={[styles.button, !isValid && styles.disabledButton]} 
              onPress={handleSubmit}
              disabled={!isValid}
            >
              <Text style={[styles.buttonText, !isValid && styles.disabledButtonText]}>
                {isRegistration ? 'Register' : 'Unlock Vault'}
              </Text>
            </TouchableOpacity>
          );
        })()}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eaf0f8', // Soft light blue-ish grey background
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)', // Glassmorphism base
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  title: {
    fontSize: 22,
    color: '#1d1d1f',
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#86868b',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 1)',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#1d1d1f',
    marginBottom: 16,
    fontSize: 16,
    textAlign: 'left',
    letterSpacing: 0,
  },
  error: {
    color: '#ff3b30',
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  button: {
    width: '100%',
    height: 50,
    backgroundColor: '#78a3f0', // Soft blue from the image
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#cbd5e1',
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledButtonText: {
    color: '#94a3b8',
  },
});
