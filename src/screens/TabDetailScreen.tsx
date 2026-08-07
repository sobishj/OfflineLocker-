import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator, Image, Platform, ScrollView } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { AppTheme } from '../theme/AppTheme';
import { Ionicons } from '@expo/vector-icons';
import { CryptoService } from '../services/CryptoService';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import WebCamera from '../components/WebCamera';

export default function TabDetailScreen({ route }: any) {
  const { tabId, unlockPin } = route.params;
  const { activeDocuments, loadDocumentsForTab, addDocument, deleteDocument, currentUser } = useWalletStore();
  
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  
  // New document
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [fileUris, setFileUris] = useState<string[]>([]);
  const [fileType, setFileType] = useState<'image' | 'pdf' | null>(null);
  
  // Web Camera
  const [webCameraVisible, setWebCameraVisible] = useState(false);
  
  // Viewing document (Popup)
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [decryptedText, setDecryptedText] = useState('');
  const [decryptedArray, setDecryptedArray] = useState<string[]>([]);

  // Right-pane preview
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewData, setPreviewData] = useState<string>('');
  const [previewDataArray, setPreviewDataArray] = useState<string[]>([]);
  const [selectedForDownload, setSelectedForDownload] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const fetchDocs = async () => {
      await loadDocumentsForTab(tabId);
      setLoading(false);
    };
    fetchDocs();
  }, [tabId]);

  useEffect(() => {
    if (activeDocuments.length > 0 && !previewDoc) {
      handleSelectPreview(activeDocuments[0]);
    } else if (activeDocuments.length === 0) {
      setPreviewDoc(null);
      setPreviewData('');
      setPreviewDataArray([]);
    }
  }, [activeDocuments, previewDoc]);

  const handleTakePhoto = async () => {
    if (Platform.OS === 'web') {
      setWebCameraVisible(true);
      return;
    }

    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission required', 'Camera permission is required to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setFileUris(prev => [...prev, `data:image/jpeg;base64,${result.assets[0].base64}`]);
      setFileType('image');
      setDocContent('');
    }
  };

  const handleWebCameraCapture = (base64DataUri: string) => {
    setFileUris(prev => [...prev, base64DataUri]);
    setFileType('image');
    setDocContent('');
    setWebCameraVisible(false);
  };

  const handleUploadFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newUris: string[] = [];
        let determinedType = fileType;
        
        for (const asset of result.assets) {
          const isImage = asset.mimeType?.startsWith('image/') || asset.name.match(/\.(jpg|jpeg|png|gif)$/i);
          if (!determinedType) determinedType = isImage ? 'image' : 'pdf';
          
          if (Platform.OS === 'web') {
            const reader = new FileReader();
            const dataUri = await new Promise<string>((resolve) => {
               reader.onload = () => resolve(reader.result as string);
               reader.readAsDataURL(asset.file as Blob);
            });
            newUris.push(dataUri);
          } else {
            const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
            const prefix = isImage ? 'image/jpeg' : 'application/pdf';
            newUris.push(`data:${prefix};base64,${base64}`);
          }
        }
        
        setFileUris(prev => [...prev, ...newUris]);
        setFileType(determinedType as any);
        setDocContent('');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to pick file');
    }
  };

  const handleAddDocument = async () => {
    if (!docTitle.trim() || (!docContent.trim() && fileUris.length === 0)) {
      Alert.alert('Error', 'Please enter a title and content (or add images/pdfs).');
      return;
    }
    
    const encryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
    const type = fileType ? fileType : 'text';
    
    // Convert array of URIs to a JSON string if multiple files are selected
    const contentToEncrypt = fileUris.length > 0 ? JSON.stringify(fileUris) : docContent;
    
    await addDocument(tabId, docTitle, type, contentToEncrypt, encryptionKey);
    setModalVisible(false);
    setDocTitle(''); setDocContent(''); setFileUris([]); setFileType(null);
  };

  const parseDecryptedContent = (plainText: string) => {
    let arr: string[] = [];
    if (plainText.startsWith('[') && plainText.endsWith(']')) {
      try {
        arr = JSON.parse(plainText);
      } catch (e) {
        arr = [plainText];
      }
    } else {
      arr = [plainText];
    }
    return arr;
  };

  const handleViewDoc = (doc: any) => {
    const decryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
    const plainText = CryptoService.decryptText(doc.encryptedContent, decryptionKey);
    setSelectedDoc(doc);
    setDecryptedText(plainText);
    if (doc.type === 'image' || doc.type === 'pdf') {
      setDecryptedArray(parseDecryptedContent(plainText));
    } else {
      setDecryptedArray([]);
    }
    setViewModalVisible(true);
  };

  const handleSelectPreview = (doc: any) => {
    const decryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
    const plainText = CryptoService.decryptText(doc.encryptedContent, decryptionKey);
    setPreviewDoc(doc);
    setPreviewData(plainText);
    if (doc.type === 'image' || doc.type === 'pdf') {
      const arr = parseDecryptedContent(plainText);
      setPreviewDataArray(arr);
      
      const initialSelection: Record<number, boolean> = {};
      arr.forEach((_, idx) => { initialSelection[idx] = true; });
      setSelectedForDownload(initialSelection);
    } else {
      setPreviewDataArray([]);
      setSelectedForDownload({});
    }
  };

  const handleDownloadFile = async (base64DataUri: string, title: string, type: string, index: number = 0) => {
    if (Platform.OS === 'web') {
      try {
        const isDataUri = base64DataUri.includes(',');
        const base64Data = isDataUri ? base64DataUri.split(',')[1] : base64DataUri;
        const mime = isDataUri ? base64DataUri.split(',')[0].split(':')[1].split(';')[0] : 'application/octet-stream';
        
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], {type: mime});
        const blobUrl = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = blobUrl;
        const ext = type === 'pdf' ? 'pdf' : type === 'image' ? 'jpg' : 'txt';
        a.download = `${title}${index > 0 ? `_${index + 1}` : ''}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        Alert.alert('Error', 'Could not process file for download.');
      }
    } else {
      try {
        const base64Data = base64DataUri.includes(',') ? base64DataUri.split(',')[1] : base64DataUri;
        const safeTitle = title.replace(/[^a-z0-9]/gi, '_');
        const ext = type === 'pdf' ? 'pdf' : type === 'image' ? 'jpg' : 'txt';
        const tempUri = `${FileSystem.documentDirectory}${safeTitle}${index > 0 ? `_${index + 1}` : ''}.${ext}`;
        await FileSystem.writeAsStringAsync(tempUri, base64Data, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(tempUri);
      } catch (error) {
        Alert.alert('Error', 'Could not download file.');
      }
    }
  };

  const handleDownloadFromCard = (doc: any) => {
    const decryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
    const plainText = CryptoService.decryptText(doc.encryptedContent, decryptionKey);
    const arr = parseDecryptedContent(plainText);
    
    // Add a small delay between downloads on Web to prevent the browser from blocking multiple popups
    arr.forEach((uri, idx) => {
      setTimeout(() => {
        handleDownloadFile(uri, doc.title, doc.type, idx);
      }, idx * 300);
    });
  };

  const handleDownloadSelected = () => {
    if (!previewDoc) return;
    let downloadCount = 0;
    previewDataArray.forEach((uri, idx) => {
      if (selectedForDownload[idx]) {
        setTimeout(() => {
          handleDownloadFile(uri, previewDoc.title, previewDoc.type, idx);
        }, downloadCount * 300);
        downloadCount++;
      }
    });
    
    if (downloadCount === 0) {
      Alert.alert('No files selected', 'Please select at least one file to download.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={AppTheme.colors.primary} />
      </View>
    );
  }

  const getIconForType = (type: string) => {
    if (type === 'image') return 'image';
    if (type === 'pdf') return 'document';
    return 'document-text';
  };

  return (
    <View style={styles.container}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        
        {/* LEFT PANE: List of Documents */}
        <View style={{ width: 400, borderRightWidth: 1, borderColor: AppTheme.colors.border }}>
          <FlatList
            data={activeDocuments}
            keyExtractor={item => item.id!.toString()}
            contentContainerStyle={{ padding: AppTheme.spacing.m }}
            renderItem={({ item }) => {
              const isSelected = previewDoc?.id === item.id;
              
              return (
                <TouchableOpacity 
                  style={[styles.docCard, isSelected && { borderColor: AppTheme.colors.primary, backgroundColor: 'rgba(6, 182, 212, 0.05)' }]} 
                  onPress={() => handleSelectPreview(item)}
                >
                  <View style={{ flex: 1, flexDirection: 'row' }}>
                    <Ionicons name={getIconForType(item.type)} size={24} color={AppTheme.colors.primary} style={{ marginRight: 12, marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docTitle}>{item.title}</Text>
                      <Text style={styles.docDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                      
                      <View style={styles.cardActionsRow}>
                        <TouchableOpacity onPress={() => handleViewDoc(item)} style={styles.cardActionBtn}>
                          <Ionicons name="eye" size={16} color={AppTheme.colors.primary} />
                          <Text style={styles.cardActionText}>View</Text>
                        </TouchableOpacity>
                        
                        {(item.type === 'image' || item.type === 'pdf') && (
                          <TouchableOpacity onPress={() => handleDownloadFromCard(item)} style={[styles.cardActionBtn, { marginLeft: 16 }]}>
                            <Ionicons name="download" size={16} color={AppTheme.colors.primary} />
                            <Text style={styles.cardActionText}>Download</Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity 
                          onPress={(e) => {
                            if (e && e.stopPropagation) e.stopPropagation();
                            
                            const doDelete = () => {
                              deleteDocument(item.id!, tabId);
                              if (previewDoc?.id === item.id) {
                                setPreviewDoc(null);
                                setPreviewData('');
                                setPreviewDataArray([]);
                              }
                            };

                            if (Platform.OS === 'web') {
                              if (window.confirm('Are you sure you want to delete this document?')) {
                                doDelete();
                              }
                            } else {
                              Alert.alert('Delete', 'Are you sure you want to delete this document?', [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Delete', style: 'destructive', onPress: doDelete }
                              ]);
                            }
                          }} 
                          style={[styles.cardActionBtn, { marginLeft: 'auto' }]}
                        >
                          <Ionicons name="trash" size={16} color={AppTheme.colors.error} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={styles.emptyText}>No documents in this vault.</Text>}
          />
        </View>

        {/* RIGHT PANE: Large Readable Preview */}
        <View style={{ flex: 1, backgroundColor: AppTheme.colors.surface }}>
          {previewDoc ? (
            <View style={{ flex: 1, padding: AppTheme.spacing.l }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ fontSize: 24, color: AppTheme.colors.text, fontWeight: 'bold' }}>
                  {previewDoc.title}
                </Text>
                <View style={{ flexDirection: 'row' }}>
                   {(previewDoc.type === 'image' || previewDoc.type === 'pdf') && (
                     <TouchableOpacity 
                       onPress={handleDownloadSelected} 
                       style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: AppTheme.colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginRight: 12 }}
                     >
                       <Ionicons name="download" size={18} color="#fff" style={{ marginRight: 8 }} />
                       <Text style={{ color: '#fff', fontWeight: 'bold' }}>Download Selected</Text>
                     </TouchableOpacity>
                   )}
                </View>
              </View>
              
              <View style={{ flex: 1, backgroundColor: AppTheme.colors.background, borderRadius: AppTheme.borderRadius.m, overflow: 'hidden', borderWidth: 1, borderColor: AppTheme.colors.border }}>
                {previewDoc.type === 'image' && (
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                     {previewDataArray.map((uri, idx) => (
                        <View key={idx} style={{ marginBottom: 16, position: 'relative' }}>
                          <Image source={{ uri }} style={{ width: '100%', height: 500, borderRadius: 8 }} resizeMode="contain" />
                          <TouchableOpacity 
                             onPress={() => setSelectedForDownload(prev => ({ ...prev, [idx]: !prev[idx] }))} 
                             style={{ position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
                          >
                             <Ionicons name={selectedForDownload[idx] ? "checkbox" : "square-outline"} size={24} color="#fff" />
                          </TouchableOpacity>
                        </View>
                     ))}
                  </ScrollView>
                )}
                {previewDoc.type === 'text' && (
                  <ScrollView style={{ flex: 1, padding: 24 }}>
                    <Text style={{ color: AppTheme.colors.text, fontSize: 18, lineHeight: 28 }}>{previewData}</Text>
                  </ScrollView>
                )}
                {previewDoc.type === 'pdf' && Platform.OS === 'web' && (
                  <ScrollView style={{ flex: 1 }}>
                     {previewDataArray.map((uri, idx) => (
                       <View key={idx} style={{ height: 600, marginBottom: 16 }}>
                         {React.createElement('iframe', {
                           src: uri,
                           style: { width: '100%', height: '100%', border: 'none' },
                           title: `${previewDoc.title} ${idx+1}`
                         })}
                       </View>
                     ))}
                  </ScrollView>
                )}
                {previewDoc.type === 'pdf' && Platform.OS !== 'web' && (
                  <View style={styles.center}>
                    <Ionicons name="document" size={64} color={AppTheme.colors.primary} />
                    <Text style={{ color: AppTheme.colors.text, marginTop: 16 }}>PDF preview is only supported on Web.</Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={80} color={AppTheme.colors.border} />
              <Text style={{ color: AppTheme.colors.textSecondary, marginTop: 24, fontSize: 18, fontWeight: '500' }}>Select a document to view its content</Text>
            </View>
          )}
        </View>

      </View>

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Ionicons name="add" size={32} color={AppTheme.colors.background} />
      </TouchableOpacity>

      {/* ADD DOCUMENT MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Secure Document</Text>
            
            <TextInput style={styles.input} placeholder="Title" placeholderTextColor={AppTheme.colors.textSecondary} value={docTitle} onChangeText={setDocTitle} />
            
            {fileUris.length === 0 && (
              <TextInput style={[styles.input, { height: 100, textAlignVertical: 'top' }]} placeholder="Secret Content / Notes" placeholderTextColor={AppTheme.colors.textSecondary} value={docContent} onChangeText={setDocContent} multiline />
            )}

            {fileUris.length > 0 && (
              <View style={styles.filePreviewContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10 }}>
                  {fileUris.map((uri, idx) => (
                     <View key={idx} style={styles.thumbnailWrapper}>
                       {fileType === 'image' ? (
                          <Image source={{ uri }} style={styles.thumbnailImage} />
                       ) : (
                          <View style={styles.thumbnailPdf}>
                             <Ionicons name="document" size={48} color={AppTheme.colors.primary} />
                             <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>PDF {idx + 1}</Text>
                          </View>
                       )}
                       <TouchableOpacity 
                          style={styles.removeFileBtn} 
                          onPress={() => {
                            const newUris = [...fileUris];
                            newUris.splice(idx, 1);
                            setFileUris(newUris);
                            if (newUris.length === 0) setFileType(null);
                          }}
                       >
                         <Ionicons name="close-circle" size={24} color={AppTheme.colors.error} />
                       </TouchableOpacity>
                     </View>
                  ))}
                  
                  {/* Option to add more photos */}
                  {fileType === 'image' && (
                     <TouchableOpacity onPress={handleTakePhoto} style={styles.addMoreTile}>
                        <Ionicons name="camera" size={32} color={AppTheme.colors.primary} />
                        <Text style={{ color: AppTheme.colors.primary, marginTop: 8, fontSize: 12, fontWeight: 'bold' }}>Add Photo</Text>
                     </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}

            {fileUris.length === 0 && (
              <View style={styles.mediaActions}>
                <TouchableOpacity onPress={handleTakePhoto} style={styles.mediaButton}>
                  <Ionicons name="camera" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleUploadFile} style={styles.mediaButton}>
                  <Ionicons name="cloud-upload" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Upload File</Text>
                </TouchableOpacity>
              </View>
            )}
            
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setModalVisible(false); setFileUris([]); setFileType(null); setDocTitle(''); setDocContent(''); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddDocument} style={styles.button}>
                <Text style={styles.buttonText}>Encrypt & Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* VIEW DOCUMENT MODAL (Popup) */}
      <Modal visible={viewModalVisible} animationType="slide" transparent={false}>
        <View style={styles.fullScreenModal}>
          
          <View style={styles.fullScreenHeader}>
            <Text style={styles.fullScreenTitle}>{selectedDoc?.title}</Text>
            <TouchableOpacity onPress={() => setViewModalVisible(false)} style={styles.closeButton}>
              <Ionicons name="close" size={32} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.fullScreenContent}>
            {selectedDoc?.type === 'image' ? (
               <ScrollView style={{ flex: 1 }}>
                  {decryptedArray.map((uri, idx) => (
                    <View key={idx} style={{ marginBottom: 20, position: 'relative' }}>
                      <Image source={{ uri }} style={{ width: '100%', height: 600 }} resizeMode="contain" />
                      <TouchableOpacity 
                         onPress={() => handleDownloadFile(uri, selectedDoc.title, 'image', idx)} 
                         style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
                      >
                         <Ionicons name="download" size={20} color="#fff" />
                         <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Download Image</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
               </ScrollView>
            ) : selectedDoc?.type === 'pdf' ? (
               Platform.OS === 'web' ? (
                 <ScrollView style={{ flex: 1 }}>
                    {decryptedArray.map((uri, idx) => (
                      <View key={idx} style={{ height: 800, marginBottom: 20 }}>
                         {React.createElement('iframe', {
                            src: uri,
                            style: { width: '100%', height: '100%', border: 'none' },
                            title: `${selectedDoc.title} ${idx + 1}`
                         })}
                      </View>
                    ))}
                 </ScrollView>
               ) : (
                 <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                   <Ionicons name="document" size={64} color={AppTheme.colors.primary} />
                   <Text style={{ color: AppTheme.colors.text, marginVertical: 10 }}>Secure PDF Document</Text>
                   <TouchableOpacity onPress={() => handleDownloadFromCard(selectedDoc)} style={styles.button}>
                     <Text style={styles.buttonText}>Download All / Open PDF</Text>
                   </TouchableOpacity>
                 </View>
               )
            ) : (
              <ScrollView style={{ flex: 1 }}>
                <Text style={styles.fullScreenText}>{decryptedText}</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* WEB CAMERA MODAL */}
      <Modal visible={webCameraVisible} animationType="slide" transparent={false}>
         <WebCamera onCapture={handleWebCameraCapture} onClose={() => setWebCameraVisible(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppTheme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: AppTheme.colors.background },
  docCard: { backgroundColor: AppTheme.colors.surface, padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.m, marginBottom: AppTheme.spacing.m, borderWidth: 1, borderColor: AppTheme.colors.border },
  docTitle: { color: AppTheme.colors.text, fontSize: 16, fontWeight: 'bold' },
  docDate: { color: AppTheme.colors.textSecondary, fontSize: 12, marginTop: 4 },
  cardActionsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  cardActionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 4 },
  cardActionText: { color: AppTheme.colors.primary, fontSize: 12, marginLeft: 6, fontWeight: '600' },
  emptyText: { color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40 },
  fab: { position: 'absolute', bottom: 30, left: 330, width: 60, height: 60, borderRadius: 30, backgroundColor: AppTheme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 5, zIndex: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: AppTheme.spacing.l },
  modalContent: { backgroundColor: AppTheme.colors.surface, padding: AppTheme.spacing.l, borderRadius: AppTheme.borderRadius.l, maxWidth: 600, width: '100%', alignSelf: 'center' },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: AppTheme.spacing.m },
  input: { backgroundColor: AppTheme.colors.background, borderWidth: 1, borderColor: AppTheme.colors.border, color: AppTheme.colors.text, padding: 12, borderRadius: AppTheme.borderRadius.s, marginBottom: AppTheme.spacing.m },
  mediaActions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: AppTheme.spacing.m },
  mediaButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: AppTheme.colors.background, borderWidth: 1, borderColor: AppTheme.colors.primary, padding: 10, borderRadius: AppTheme.borderRadius.s, marginHorizontal: 2 },
  mediaButtonText: { color: AppTheme.colors.primary, marginLeft: 4, fontWeight: '600', fontSize: 12 },
  
  // Multi-file thumbnails
  filePreviewContainer: { marginBottom: AppTheme.spacing.m },
  thumbnailWrapper: { position: 'relative', marginRight: 16, width: 120, height: 120 },
  thumbnailImage: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m },
  thumbnailPdf: { width: 120, height: 120, backgroundColor: AppTheme.colors.background, borderRadius: AppTheme.borderRadius.m, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: AppTheme.colors.border },
  removeFileBtn: { position: 'absolute', top: -10, right: -10, backgroundColor: '#000', borderRadius: 12 },
  addMoreTile: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m, borderWidth: 1, borderColor: AppTheme.colors.primary, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6, 182, 212, 0.05)' },
  
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: AppTheme.spacing.s },
  button: { flex: 1, backgroundColor: AppTheme.colors.primary, padding: 12, borderRadius: AppTheme.borderRadius.s, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  decryptedBox: { backgroundColor: AppTheme.colors.background, padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.s, marginVertical: AppTheme.spacing.m, minHeight: 100 },
  decryptedText: { color: AppTheme.colors.text, fontSize: 16, lineHeight: 24 },
  
  fullScreenModal: { flex: 1, backgroundColor: '#000' },
  fullScreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 40, backgroundColor: 'rgba(0,0,0,0.8)' },
  fullScreenTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  closeButton: { padding: 8 },
  fullScreenContent: { flex: 1, padding: 20 },
  fullScreenText: { color: '#fff', fontSize: 18, lineHeight: 28 }
});
