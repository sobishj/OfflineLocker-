import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { AppTheme } from '../theme/AppTheme';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type DashboardProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function DashboardScreen({ navigation }: DashboardProps) {
  const { tabs, logout, createTab, deleteTab, verifyTabPin } = useWalletStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  
  // New tab state
  const [tabName, setTabName] = useState('');
  const [tabDesc, setTabDesc] = useState('');
  const [isSensitive, setIsSensitive] = useState(false);
  const [tabPin, setTabPin] = useState('');

  // Unlock tab state
  const [selectedTab, setSelectedTab] = useState<any>(null);
  const [unlockPin, setUnlockPin] = useState('');

  const handleCreateTab = async () => {
    const success = await createTab(tabName, tabDesc, isSensitive, tabPin);
    if (success) {
      setModalVisible(false);
      setTabName(''); setTabDesc(''); setIsSensitive(false); setTabPin('');
    } else {
      Alert.alert('Error', 'Failed to create tab. Ensure sensitive tabs have a 4-digit PIN.');
    }
  };

  const handleTabPress = (tab: any) => {
    if (tab.isSensitive) {
      setSelectedTab(tab);
      setPinModalVisible(true);
    } else {
      navigation.navigate('TabDetail', { tabId: tab.uuid, tabName: tab.name });
    }
  };

  const handleUnlockTab = () => {
    if (selectedTab && verifyTabPin(selectedTab, unlockPin)) {
      setPinModalVisible(false);
      setUnlockPin('');
      navigation.navigate('TabDetail', { tabId: selectedTab.uuid, tabName: selectedTab.name, unlockPin });
    } else {
      Alert.alert('Error', 'Incorrect PIN');
    }
  };

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={logout} style={{ marginRight: 15 }}>
          <Ionicons name="log-out-outline" size={24} color={AppTheme.colors.primary} />
        </TouchableOpacity>
      )
    });
  }, [navigation]);

  return (
    <View style={styles.container}>
      <FlatList
        data={tabs}
        keyExtractor={item => item.uuid}
        contentContainerStyle={{ padding: AppTheme.spacing.m }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.tabCard} onPress={() => handleTabPress(item)} onLongPress={() => {
            Alert.alert('Delete', 'Are you sure you want to delete this tab?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => deleteTab(item.uuid) }
            ]);
          }}>
            <View>
              <Text style={styles.tabName}>{item.name}</Text>
              <Text style={styles.tabDesc}>{item.description}</Text>
            </View>
            {item.isSensitive === 1 && (
              <Ionicons name="lock-closed" size={24} color={AppTheme.colors.sensitive} />
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No tabs available. Create one below.</Text>}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Ionicons name="add" size={32} color={AppTheme.colors.background} />
      </TouchableOpacity>

      {/* CREATE TAB MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Vault Tab</Text>
            <TextInput style={styles.input} placeholder="Tab Name" placeholderTextColor={AppTheme.colors.textSecondary} value={tabName} onChangeText={setTabName} />
            <TextInput style={styles.input} placeholder="Description" placeholderTextColor={AppTheme.colors.textSecondary} value={tabDesc} onChangeText={setTabDesc} />
            
            <TouchableOpacity style={styles.checkboxRow} onPress={() => setIsSensitive(!isSensitive)}>
              <Ionicons name={isSensitive ? "checkbox" : "square-outline"} size={24} color={AppTheme.colors.primary} />
              <Text style={styles.checkboxText}>Sensitive Tab (Requires PIN)</Text>
            </TouchableOpacity>

            {isSensitive && (
              <TextInput style={styles.input} placeholder="4-Digit Tab PIN" placeholderTextColor={AppTheme.colors.textSecondary} value={tabPin} onChangeText={setTabPin} keyboardType="numeric" secureTextEntry maxLength={4} />
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateTab} style={styles.button}>
                <Text style={styles.buttonText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* UNLOCK TAB MODAL */}
      <Modal visible={pinModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Unlock {selectedTab?.name}</Text>
            <TextInput style={styles.input} placeholder="4-Digit PIN" placeholderTextColor={AppTheme.colors.textSecondary} value={unlockPin} onChangeText={setUnlockPin} keyboardType="numeric" secureTextEntry maxLength={4} />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setPinModalVisible(false); setUnlockPin(''); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleUnlockTab} style={styles.button}>
                <Text style={styles.buttonText}>Unlock</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppTheme.colors.background },
  tabCard: { backgroundColor: AppTheme.colors.surface, padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.m, marginBottom: AppTheme.spacing.m, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: AppTheme.colors.border },
  tabName: { color: AppTheme.colors.text, fontSize: 18, fontWeight: 'bold' },
  tabDesc: { color: AppTheme.colors.textSecondary, fontSize: 14, marginTop: 4 },
  emptyText: { color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40 },
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: AppTheme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: AppTheme.spacing.l },
  modalContent: { backgroundColor: AppTheme.colors.surface, padding: AppTheme.spacing.l, borderRadius: AppTheme.borderRadius.l },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: AppTheme.spacing.m },
  input: { backgroundColor: AppTheme.colors.background, borderWidth: 1, borderColor: AppTheme.colors.border, color: AppTheme.colors.text, padding: 12, borderRadius: AppTheme.borderRadius.s, marginBottom: AppTheme.spacing.m },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: AppTheme.spacing.m },
  checkboxText: { color: AppTheme.colors.text, marginLeft: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: AppTheme.spacing.s },
  button: { flex: 1, backgroundColor: AppTheme.colors.primary, padding: 12, borderRadius: AppTheme.borderRadius.s, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: 'bold' }
});
