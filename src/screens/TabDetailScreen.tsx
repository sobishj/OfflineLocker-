import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator, Image, Platform, ScrollView, KeyboardAvoidingView } from 'react-native';
import { useWalletStore } from '../store/useWalletStore';
import { AppTheme } from '../theme/AppTheme';
import { Ionicons } from '@expo/vector-icons';
import { CryptoService } from '../services/CryptoService';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImageManipulator from 'expo-image-manipulator';
import WebCamera from '../components/WebCamera';
import CustomImageCropper from '../components/CustomImageCropper';
import { WebView } from 'react-native-webview';
import DraggableFAB from '../components/DraggableFAB';

export default function TabDetailScreen({ route }: any) {
  const { tabId, unlockPin } = route.params;
  const { activeDocuments, loadDocumentsForTab, addDocument, updateDocument, deleteDocument, currentUser } = useWalletStore();
  
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  
  // New document
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [fileUris, setFileUris] = useState<string[]>([]);
  const [fileType, setFileType] = useState<'image' | 'pdf' | null>(null);
  
  // Edit document
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any>(null);
  const [editDocTitle, setEditDocTitle] = useState('');
  const [editDocContent, setEditDocContent] = useState('');
  const [editFileUris, setEditFileUris] = useState<string[]>([]);
  const [editFileType, setEditFileType] = useState<'image' | 'pdf' | 'text' | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Web Camera
  const [webCameraVisible, setWebCameraVisible] = useState(false);

  // Active image index for crop modal
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [cropTarget, setCropTarget] = useState<'add' | 'edit' | null>(null);
  
  // Viewing document (Popup)
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [decryptedText, setDecryptedText] = useState('');
  const [decryptedArray, setDecryptedArray] = useState<string[]>([]);

  // Right-pane preview
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewData, setPreviewData] = useState<string>('');
  const [previewDataArray, setPreviewDataArray] = useState<string[]>([]);
  const [selectedForDownload, setSelectedForDownload] = useState<Record<number, boolean>>({});

  // In-memory cache for decrypted document content to prevent duplicate decryptions
  const decryptionCacheRef = useRef<Map<string | number, { plainText: string; array: string[] }>>(new Map());

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

  const isSharingRef = useRef(false);
  const isPickerBusyRef = useRef(false);
  const isViewingRef = useRef(false);

  const optimizeImageUri = async (uri: string): Promise<string> => {
    if (!uri || !uri.startsWith('data:image')) return uri;
    try {
      const res = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (res && res.base64) {
        return `data:image/jpeg;base64,${res.base64}`;
      }
    } catch (e) {
      // Return original URI if optimization fails or isn't needed
    }
    return uri;
  };

  const [webCameraTarget, setWebCameraTarget] = useState<'add' | 'edit'>('add');

  const handleTakePhoto = async (isEdit = false) => {
    if (isPickerBusyRef.current) return;
    isPickerBusyRef.current = true;
    try {
      if (Platform.OS === 'web') {
        setWebCameraTarget(isEdit ? 'edit' : 'add');
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
        quality: 0.5,
        base64: true,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        let newUri = `data:image/jpeg;base64,${result.assets[0].base64}`;
        newUri = await optimizeImageUri(newUri);
        if (isEdit) {
          const newIndex = editFileUris.length;
          setEditFileUris(prev => [...prev, newUri]);
          setEditFileType('image');
          setEditDocContent('');
          if ((Platform.OS as string) !== 'web') {
            setCropTarget('edit');
            setCropIndex(newIndex);
          }
        } else {
          const newIndex = fileUris.length;
          setFileUris(prev => [...prev, newUri]);
          setFileType('image');
          setDocContent('');
          if ((Platform.OS as string) !== 'web') {
            setCropTarget('add');
            setCropIndex(newIndex);
          }
        }
      }
    } catch (e) {
      console.warn('Camera launch error:', e);
    } finally {
      isPickerBusyRef.current = false;
    }
  };

  const handleWebCameraCapture = async (base64DataUri: string) => {
    const optimized = await optimizeImageUri(base64DataUri);
    if (webCameraTarget === 'edit') {
      const newIndex = editFileUris.length;
      setEditFileUris(prev => [...prev, optimized]);
      setEditFileType('image');
      setEditDocContent('');
      setWebCameraVisible(false);
      if (Platform.OS !== 'web') {
        setCropTarget('edit');
        setCropIndex(newIndex);
      }
    } else {
      const newIndex = fileUris.length;
      setFileUris(prev => [...prev, optimized]);
      setFileType('image');
      setDocContent('');
      setWebCameraVisible(false);
      if (Platform.OS !== 'web') {
        setCropTarget('add');
        setCropIndex(newIndex);
      }
    }
  };

  const handleGalleryPick = async (isEdit = false) => {
    if (isPickerBusyRef.current) return;
    isPickerBusyRef.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        base64: true,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        let newUri = `data:image/jpeg;base64,${result.assets[0].base64}`;
        newUri = await optimizeImageUri(newUri);
        if (isEdit) {
          const newIndex = editFileUris.length;
          setEditFileUris(prev => [...prev, newUri]);
          setEditFileType('image');
          setEditDocContent('');
          if (Platform.OS !== 'web') {
            setCropTarget('edit');
            setCropIndex(newIndex);
          }
        } else {
          const newIndex = fileUris.length;
          setFileUris(prev => [...prev, newUri]);
          setFileType('image');
          setDocContent('');
          if (Platform.OS !== 'web') {
            setCropTarget('add');
            setCropIndex(newIndex);
          }
        }
      }
    } catch (e) {
      console.warn('Gallery pick error:', e);
    } finally {
      isPickerBusyRef.current = false;
    }
  };

  const handleUploadFile = async (isEdit = false) => {
    if (isPickerBusyRef.current) return;
    isPickerBusyRef.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newUris: string[] = [];
        let determinedType = isEdit ? editFileType : fileType;
        
        for (const asset of result.assets) {
          const isImage = asset.mimeType?.startsWith('image/') || asset.name.match(/\.(jpg|jpeg|png|gif)$/i);
          if (!determinedType) determinedType = isImage ? 'image' : 'pdf';
          
          let dataUri = '';
          if (Platform.OS === 'web') {
            const reader = new FileReader();
            const uriPromise = new Promise<string>((resolve) => {
              reader.onload = (e) => resolve(e.target?.result as string);
            });
            reader.readAsDataURL(asset.file as any);
            dataUri = await uriPromise;
          } else {
            const base64Data = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
            const mimeType = asset.mimeType || (isImage ? 'image/jpeg' : 'application/pdf');
            dataUri = `data:${mimeType};base64,${base64Data}`;
          }

          if (isImage) {
            dataUri = await optimizeImageUri(dataUri);
          }
          newUris.push(dataUri);
        }
        
        if (isEdit) {
          setEditFileType(determinedType as any);
          setEditFileUris(prev => [...prev, ...newUris]);
          setEditDocContent('');
        } else {
          setFileType(determinedType as any);
          setFileUris(prev => [...prev, ...newUris]);
          setDocContent('');
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Could not pick document.');
    } finally {
      isPickerBusyRef.current = false;
    }
  };

  const handleAddDocument = async () => {
    if (!docTitle.trim()) {
      Alert.alert('Error', 'Please enter a title for the document.');
      return;
    }
    if (isEncrypting) return;

    setIsEncrypting(true);

    setTimeout(async () => {
      try {
        const encryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
        const type = fileType ? fileType : 'text';
        
        let processedUris = fileUris;
        if (type === 'image' && fileUris.length > 0) {
          processedUris = await Promise.all(fileUris.map(uri => optimizeImageUri(uri)));
        }

        let contentToEncrypt = '';
        if (processedUris.length > 0 && docContent.trim()) {
          contentToEncrypt = JSON.stringify({ notes: docContent.trim(), files: processedUris });
        } else if (processedUris.length > 0) {
          contentToEncrypt = JSON.stringify(processedUris);
        } else {
          contentToEncrypt = docContent;
        }
        
        await addDocument(tabId, docTitle, type, contentToEncrypt, encryptionKey);
        setModalVisible(false);
        setDocTitle(''); setDocContent(''); setFileUris([]); setFileType(null);
      } catch (e) {
        console.error('handleAddDocument error:', e);
        Alert.alert('Error', 'Could not encrypt and save document.');
      } finally {
        setIsEncrypting(false);
      }
    }, 50);
  };

  const handleOpenEditDoc = (doc: any) => {
    if (!doc) return;
    setEditingDoc(doc);
    setEditDocTitle(doc.title);
    setEditFileType(doc.type as any);
    
    const decryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
    const plainText = CryptoService.decryptText(doc.encryptedContent || '', decryptionKey);
    
    const payload = parseDecryptedPayload(plainText);
    setEditDocContent(payload.notes);
    setEditFileUris(payload.files);
    
    setEditModalVisible(true);
  };

  const handleSaveEditDoc = async () => {
    if (!editDocTitle.trim() || !editingDoc) {
      Alert.alert('Error', 'Please enter a title for the document.');
      return;
    }
    if (isUpdating) return;

    setIsUpdating(true);

    setTimeout(async () => {
      try {
        const encryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
        const type = editFileType ? editFileType : 'text';
        
        let processedUris = editFileUris;
        if (type === 'image' && editFileUris.length > 0) {
          processedUris = await Promise.all(editFileUris.map(uri => optimizeImageUri(uri)));
        }

        let contentToEncrypt = '';
        if (processedUris.length > 0 && editDocContent.trim()) {
          contentToEncrypt = JSON.stringify({ notes: editDocContent.trim(), files: processedUris });
        } else if (processedUris.length > 0) {
          contentToEncrypt = JSON.stringify(processedUris);
        } else {
          contentToEncrypt = editDocContent;
        }
        
        await updateDocument(editingDoc.id, tabId, editDocTitle, contentToEncrypt, encryptionKey);
        
        const freshEncrypted = CryptoService.encryptText(contentToEncrypt, encryptionKey);
        const updatedDoc = { ...editingDoc, title: editDocTitle.trim(), encryptedContent: freshEncrypted };
        
        if (editingDoc.id) {
          decryptionCacheRef.current.delete(editingDoc.id);
        }

        if (previewDoc?.id === editingDoc.id) {
          handleSelectPreview(updatedDoc);
        }
        if (selectedDoc?.id === editingDoc.id) {
          setSelectedDoc(updatedDoc);
          setDecryptedText(contentToEncrypt);
        }

        setEditModalVisible(false);
        setEditingDoc(null);
        setEditDocTitle(''); setEditDocContent(''); setEditFileUris([]); setEditFileType(null);
      } catch (e) {
        console.error('handleSaveEditDoc error:', e);
        Alert.alert('Error', 'Could not update document.');
      } finally {
        setIsUpdating(false);
      }
    }, 50);
  };

  const parseDecryptedPayload = (plainText: string): { notes: string; files: string[] } => {
    if (!plainText || typeof plainText !== 'string') return { notes: '', files: [] };
    const trimmed = plainText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          const notes = typeof parsed.notes === 'string' ? parsed.notes : '';
          const files = Array.isArray(parsed.files) ? parsed.files.filter((f: any) => typeof f === 'string') : [];
          return { notes, files };
        }
      } catch (e) {}
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const files = parsed.filter((item: any) => typeof item === 'string' && item.length > 0);
          return { notes: '', files };
        }
      } catch (e) {}
    }
    return { notes: plainText, files: [] };
  };

  const parseDecryptedContent = (plainText: string): string[] => {
    return parseDecryptedPayload(plainText).files;
  };

  const getSafeImageUri = (uri: string) => {
    if (!uri) return '';
    if (uri.startsWith('data:')) return uri;
    if (uri.startsWith('http') || uri.startsWith('file://')) return encodeURI(uri);
    return ''; // Invalid URI prevents crash
  };

  const getThumbnailForItem = (item: any): string | null => {
    if (item.type !== 'image' || !item.encryptedContent) return null;
    if (item.id && decryptionCacheRef.current.has(item.id)) {
      const cached = decryptionCacheRef.current.get(item.id)!;
      return cached.array[0] || null;
    }
    try {
      const decryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
      const plainText = CryptoService.decryptText(item.encryptedContent || '', decryptionKey);
      const files = parseDecryptedContent(plainText);
      return files[0] || null;
    } catch (e) {
      return null;
    }
  };

  const prepareLocalFiles = async (dataUris: string[], docTitle: string, type: string): Promise<string[]> => {
    if (Platform.OS === 'web' || type === 'image') return dataUris;
    
    const safeTitle = (docTitle || 'doc').replace(/[^a-z0-9]/gi, '_');
    return Promise.all(
      dataUris.map(async (uri, i) => {
        if (uri.startsWith('data:')) {
          try {
            const base64Data = uri.includes(',') ? uri.split(',')[1] : uri;
            const ext = type === 'pdf' ? 'pdf' : 'jpg';
            const tempUri = `${FileSystem.cacheDirectory}${safeTitle}_preview_${i}.${ext}`;
            await FileSystem.writeAsStringAsync(tempUri, base64Data, { encoding: 'base64' });
            return tempUri;
          } catch (e) {
            return uri;
          }
        }
        return uri;
      })
    );
  };

  const handleViewDoc = (doc: any) => {
    if (!doc) return;
    if (isViewingRef.current) return;
    isViewingRef.current = true;

    setSelectedDoc(doc);
    setViewModalVisible(true);

    if (doc.id && decryptionCacheRef.current.has(doc.id)) {
      const cached = decryptionCacheRef.current.get(doc.id)!;
      setDecryptedText(cached.plainText);
      setDecryptedArray(cached.array);
      isViewingRef.current = false;
      return;
    }

    setDecryptedArray([]);

    setTimeout(async () => {
      try {
        const decryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
        const plainText = CryptoService.decryptText(doc.encryptedContent || '', decryptionKey);
        setDecryptedText(plainText);
        let prepared: string[] = [];
        if (doc.type === 'image' || doc.type === 'pdf') {
          const rawArr = parseDecryptedContent(plainText);
          prepared = await prepareLocalFiles(rawArr, doc.title || 'doc', doc.type);
          setDecryptedArray(prepared);
        }
        if (doc.id) {
          decryptionCacheRef.current.set(doc.id, { plainText, array: prepared });
        }
      } catch (err) {
        console.warn('handleViewDoc error:', err);
      } finally {
        isViewingRef.current = false;
      }
    }, 10);
  };

  const handleSelectPreview = async (doc: any) => {
    if (!doc) return;
    setPreviewDoc(doc);

    if (doc.id && decryptionCacheRef.current.has(doc.id)) {
      const cached = decryptionCacheRef.current.get(doc.id)!;
      setPreviewData(cached.plainText);
      setPreviewDataArray(cached.array);
      if (cached.array.length > 0) {
        const initialSelection: Record<number, boolean> = {};
        cached.array.forEach((_, idx) => { initialSelection[idx] = true; });
        setSelectedForDownload(initialSelection);
      } else {
        setSelectedForDownload({});
      }
      return;
    }

    const decryptionKey = unlockPin || currentUser?.pinHash || 'default_fallback';
    const plainText = CryptoService.decryptText(doc.encryptedContent || '', decryptionKey);
    setPreviewData(plainText);

    let arr: string[] = [];
    if (doc.type === 'image' || doc.type === 'pdf') {
      const rawArr = parseDecryptedContent(plainText);
      arr = await prepareLocalFiles(rawArr, doc.title || 'doc', doc.type);
      setPreviewDataArray(arr);
      
      const initialSelection: Record<number, boolean> = {};
      arr.forEach((_, idx) => { initialSelection[idx] = true; });
      setSelectedForDownload(initialSelection);
    } else {
      setPreviewDataArray([]);
      setSelectedForDownload({});
    }

    if (doc.id) {
      decryptionCacheRef.current.set(doc.id, { plainText, array: arr });
    }
  };

  const handleDownloadFile = async (base64DataUri: string, title: string, type: string, index: number = 0) => {
    if (!base64DataUri) return;
    if (Platform.OS === 'web') {
      try {
        const res = await fetch(base64DataUri);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = blobUrl;
        const ext = type === 'pdf' ? 'pdf' : type === 'image' ? 'jpg' : 'txt';
        a.download = `${title || 'file'}${index > 0 ? `_${index + 1}` : ''}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        Alert.alert('Error', 'Could not process file for download.');
      }
    } else {
      if (isSharingRef.current) return;
      isSharingRef.current = true;
      try {
        let targetUri = base64DataUri;
        if (base64DataUri.startsWith('data:')) {
          const base64Data = base64DataUri.includes(',') ? base64DataUri.split(',')[1] : base64DataUri;
          const safeTitle = (title || 'file').replace(/[^a-z0-9]/gi, '_');
          const ext = type === 'pdf' ? 'pdf' : type === 'image' ? 'jpg' : 'txt';
          targetUri = `${FileSystem.cacheDirectory}${safeTitle}${index > 0 ? `_${index + 1}` : ''}.${ext}`;
          await FileSystem.writeAsStringAsync(targetUri, base64Data, { encoding: 'base64' });
        }
        await Sharing.shareAsync(targetUri);
      } catch (error) {
        console.warn('Share error:', error);
      } finally {
        isSharingRef.current = false;
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
            ListHeaderComponent={
              <View style={{ marginBottom: 12, paddingHorizontal: 4 }}>
                <Text style={{ fontSize: 13, color: AppTheme.colors.textSecondary, fontWeight: '500' }}>
                  {activeDocuments.length} {activeDocuments.length === 1 ? 'item' : 'items'} · Sorted by Date
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = previewDoc?.id === item.id;
              const thumbUri = getThumbnailForItem(item);
              const formattedDate = new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
              const badgeType = item.type === 'image' ? 'JPG' : item.type === 'pdf' ? 'PDF' : 'NOTE';

              const doDelete = () => {
                deleteDocument(item.id!, tabId);
                if (previewDoc?.id === item.id) {
                  setPreviewDoc(null);
                  setPreviewData('');
                  setPreviewDataArray([]);
                }
              };

              const handleDeleteClick = (e: any) => {
                if (e && e.stopPropagation) e.stopPropagation();
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
              };

              return (
                <TouchableOpacity 
                  style={[styles.docCard, isSelected && { borderColor: AppTheme.colors.primary, backgroundColor: 'rgba(6, 182, 212, 0.04)' }]} 
                  onPress={() => {
                    handleSelectPreview(item);
                    handleViewDoc(item);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {/* Square Thumbnail Box */}
                    <View style={styles.docThumbBox}>
                      {thumbUri ? (
                        <Image source={{ uri: thumbUri }} style={{ width: 56, height: 56, borderRadius: 8 }} resizeMode="cover" />
                      ) : (
                        <Ionicons name={getIconForType(item.type)} size={28} color={AppTheme.colors.primary} />
                      )}
                    </View>

                    {/* Document Meta */}
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.docTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.docDate}>{formattedDate}</Text>
                      
                      <View style={styles.typeBadge}>
                        <Text style={styles.typeBadgeText}>{badgeType}</Text>
                      </View>
                    </View>
                  </View>

                  {/* Divider line */}
                  <View style={{ height: 1, backgroundColor: AppTheme.colors.border, marginVertical: 10 }} />

                  {/* Bottom Action Bar */}
                  <View style={styles.cardActionsRow}>
                    <TouchableOpacity 
                      onPress={(e) => {
                        if (e && e.stopPropagation) e.stopPropagation();
                        handleSelectPreview(item);
                        handleViewDoc(item);
                      }} 
                      style={styles.cardActionItem}
                    >
                      <Ionicons name="eye-outline" size={15} color={AppTheme.colors.primary} style={{ marginRight: 4 }} />
                      <Text style={styles.cardActionText}>View</Text>
                    </TouchableOpacity>

                    <View style={styles.actionDivider} />

                    <TouchableOpacity 
                      onPress={(e) => {
                        if (e && e.stopPropagation) e.stopPropagation();
                        handleDownloadFromCard(item);
                      }} 
                      style={styles.cardActionItem}
                    >
                      <Ionicons name="download-outline" size={15} color={AppTheme.colors.primary} style={{ marginRight: 4 }} />
                      <Text style={styles.cardActionText}>Download</Text>
                    </TouchableOpacity>

                    <View style={styles.actionDivider} />

                    <TouchableOpacity 
                      onPress={(e) => {
                        if (e && e.stopPropagation) e.stopPropagation();
                        handleOpenEditDoc(item);
                      }} 
                      style={styles.cardActionItem}
                    >
                      <Ionicons name="pencil" size={15} color={AppTheme.colors.primary} style={{ marginRight: 4 }} />
                      <Text style={styles.cardActionText}>Edit</Text>
                    </TouchableOpacity>

                    <View style={styles.actionDivider} />

                    <TouchableOpacity 
                      onPress={handleDeleteClick} 
                      style={styles.cardActionItem}
                    >
                      <Ionicons name="trash-outline" size={15} color={AppTheme.colors.error} />
                    </TouchableOpacity>
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
                     {previewDataArray.map((uri, idx) => {
                        const safeUri = getSafeImageUri(uri);
                        if (!safeUri) return null;
                        return (
                          <View key={idx} style={{ marginBottom: 16, position: 'relative' }}>
                            <Image source={{ uri: safeUri }} style={{ width: '100%', height: 500, borderRadius: 8 }} resizeMode="contain" />
                            <TouchableOpacity 
                               onPress={() => setSelectedForDownload(prev => ({ ...prev, [idx]: !prev[idx] }))} 
                               style={{ position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
                            >
                               <Ionicons name={selectedForDownload[idx] ? "checkbox" : "square-outline"} size={24} color="#fff" />
                            </TouchableOpacity>
                          </View>
                        );
                     })}
                  </ScrollView>
                )}
                {previewDoc.type === 'text' && (
                  <ScrollView style={{ flex: 1, padding: 24 }}>
                    <Text style={{ color: AppTheme.colors.text, fontSize: 18, lineHeight: 28 }}>{previewData}</Text>
                  </ScrollView>
                )}
                {previewDoc.type === 'pdf' && Platform.OS === 'web' && (() => {
                   // Convert base64 data URIs → Blob URLs so browsers can render them in iframes
                   // (browsers block data: URIs inside iframes for security)
                   const blobUrls = previewDataArray.map(uri => {
                     if (!uri) return '';
                     if (uri.startsWith('blob:')) return uri;
                     if (uri.startsWith('data:')) {
                       try {
                         const [header, base64] = uri.split(',');
                         const mimeMatch = header.match(/data:([^;]+)/);
                         const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
                         const binary = atob(base64);
                         const bytes = new Uint8Array(binary.length);
                         for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                         return URL.createObjectURL(new Blob([bytes], { type: mime }));
                       } catch {
                         return uri;
                       }
                     }
                     return uri;
                   });
                   return (
                     <ScrollView style={{ flex: 1 }}>
                       {blobUrls.map((blobUrl, idx) => (
                         <View key={idx} style={{ marginBottom: 16 }}>
                           <View style={{ height: 700 }}>
                             {React.createElement('iframe', {
                               src: blobUrl,
                               style: { width: '100%', height: '100%', border: 'none', borderRadius: 8 },
                               title: `${previewDoc.title} ${idx + 1}`,
                             })}
                           </View>
                           <TouchableOpacity
                             onPress={() => window.open(blobUrl, '_blank')}
                             style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, padding: 10, backgroundColor: AppTheme.colors.primary, borderRadius: 8 }}
                           >
                             <Ionicons name="open-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                             <Text style={{ color: '#fff', fontWeight: '600' }}>Open in New Tab</Text>
                           </TouchableOpacity>
                         </View>
                       ))}
                     </ScrollView>
                   );
                 })()
                }
                {previewDoc.type === 'pdf' && Platform.OS !== 'web' && (
                  <ScrollView style={{ flex: 1 }}>
                     {previewDataArray.map((uri, idx) => (
                       <View key={idx} style={{ height: 600, marginBottom: 16 }}>
                         <WebView originWhitelist={['*']} source={{ uri }} style={{ flex: 1 }} />
                       </View>
                     ))}
                  </ScrollView>
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

      <DraggableFAB onPress={() => setModalVisible(true)} />

      {/* ADD DOCUMENT MODAL */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
            <Text style={styles.modalTitle}>Add Secure Document</Text>
            
            <TextInput style={[styles.input, { letterSpacing: 0 }]} placeholder="Title" placeholderTextColor={AppTheme.colors.textSecondary} value={docTitle} onChangeText={setDocTitle} />
            
            <TextInput style={[styles.input, { height: 90, textAlignVertical: 'top', letterSpacing: 0 }]} placeholder="Secret Content / Notes" placeholderTextColor={AppTheme.colors.textSecondary} value={docContent} onChangeText={setDocContent} multiline />

            {fileUris.length > 0 && (
              <View style={styles.filePreviewContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10 }}>
                  {fileUris.map((uri, idx) => {
                     const safeUri = getSafeImageUri(uri);
                     return (
                     <View key={idx} style={styles.thumbnailWrapper}>
                       {fileType === 'image' && safeUri ? (
                          <Image source={{ uri: safeUri }} style={styles.thumbnailImage} />
                       ) : fileType === 'image' && !safeUri ? (
                          <View style={styles.thumbnailPdf}>
                             <Ionicons name="warning" size={48} color={AppTheme.colors.error} />
                             <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>Invalid Image</Text>
                          </View>
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
                        {fileType === 'image' && safeUri && Platform.OS !== 'web' && (
                          <TouchableOpacity 
                            style={{
                              position: 'absolute',
                              bottom: -6,
                              left: -6,
                              backgroundColor: AppTheme.colors.primary,
                              borderRadius: 12,
                              padding: 4,
                              elevation: 3,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.2,
                              shadowRadius: 3,
                            }}
                            onPress={() => {
                              setCropTarget('add');
                              setCropIndex(idx);
                            }}
                          >
                            <Ionicons name="crop" size={16} color="#fff" />
                          </TouchableOpacity>
                        )}
                     </View>
                     );
                  })}
                  
                  {/* Option to add more photos */}
                  {fileType === 'image' && (
                     <TouchableOpacity onPress={() => handleTakePhoto(false)} style={styles.addMoreTile}>
                        <Ionicons name="camera" size={32} color={AppTheme.colors.primary} />
                        <Text style={{ color: AppTheme.colors.primary, marginTop: 8, fontSize: 12, fontWeight: 'bold' }}>Add Photo</Text>
                     </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}

            {fileUris.length === 0 && (
              <View style={styles.mediaActions}>
                <TouchableOpacity onPress={() => handleTakePhoto(false)} style={styles.mediaButton}>
                  <Ionicons name="camera" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleGalleryPick(false)} style={styles.mediaButton}>
                  <Ionicons name="image" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleUploadFile(false)} style={styles.mediaButton}>
                  <Ionicons name="document-attach" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Files</Text>
                </TouchableOpacity>
              </View>
            )}
            
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setModalVisible(false); setFileUris([]); setFileType(null); setDocTitle(''); setDocContent(''); }} style={[styles.button, { backgroundColor: AppTheme.colors.border }]} disabled={isEncrypting}>
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddDocument} style={styles.button} disabled={isEncrypting}>
                {isEncrypting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Encrypt & Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {cropIndex !== null && cropIndex >= 0 && (
            <View style={[StyleSheet.absoluteFill, { zIndex: 999999, elevation: 999999, backgroundColor: '#000' }]}>
              <CustomImageCropper
                imageUri={cropTarget === 'edit' ? editFileUris[cropIndex] : fileUris[cropIndex]}
                onCropDone={(croppedBase64Uri) => {
                  if (cropTarget === 'edit') {
                    const updated = [...editFileUris];
                    updated[cropIndex] = croppedBase64Uri;
                    setEditFileUris(updated);
                  } else {
                    const updated = [...fileUris];
                    updated[cropIndex] = croppedBase64Uri;
                    setFileUris(updated);
                  }
                  setCropIndex(null);
                  setCropTarget(null);
                }}
                onCancel={() => {
                  setCropIndex(null);
                  setCropTarget(null);
                }}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT DOCUMENT MODAL */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={styles.modalOverlay}
        >
          <View style={[styles.modalContent, { maxHeight: '95%' }]}>
            <Text style={styles.modalTitle}>Edit Document</Text>
            
            <TextInput 
              style={[styles.input, { letterSpacing: 0 }]} 
              placeholder="Title" 
              placeholderTextColor={AppTheme.colors.textSecondary} 
              value={editDocTitle} 
              onChangeText={setEditDocTitle} 
            />
            
            <TextInput 
              style={[styles.input, { height: 90, textAlignVertical: 'top', letterSpacing: 0 }]} 
              placeholder="Secret Content / Notes" 
              placeholderTextColor={AppTheme.colors.textSecondary} 
              value={editDocContent} 
              onChangeText={setEditDocContent} 
              multiline 
            />

            {editFileUris.length > 0 && (
              <View style={styles.filePreviewContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10 }}>
                  {editFileUris.map((uri, idx) => {
                     const safeUri = getSafeImageUri(uri);
                     return (
                     <View key={idx} style={styles.thumbnailWrapper}>
                       {editFileType === 'image' && safeUri ? (
                          <Image source={{ uri: safeUri }} style={styles.thumbnailImage} />
                       ) : editFileType === 'image' && !safeUri ? (
                          <View style={styles.thumbnailPdf}>
                             <Ionicons name="warning" size={48} color={AppTheme.colors.error} />
                             <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>Invalid Image</Text>
                          </View>
                       ) : (
                          <View style={styles.thumbnailPdf}>
                             <Ionicons name="document" size={48} color={AppTheme.colors.primary} />
                             <Text style={{ color: AppTheme.colors.text, marginTop: 8, fontSize: 10 }}>PDF {idx + 1}</Text>
                          </View>
                       )}
                       <TouchableOpacity 
                           style={styles.removeFileBtn} 
                           onPress={() => {
                             const newUris = [...editFileUris];
                             newUris.splice(idx, 1);
                             setEditFileUris(newUris);
                             if (newUris.length === 0) setEditFileType(null);
                           }}
                        >
                          <Ionicons name="close-circle" size={24} color={AppTheme.colors.error} />
                        </TouchableOpacity>
                        {editFileType === 'image' && safeUri && Platform.OS !== 'web' && (
                          <TouchableOpacity 
                            style={{
                              position: 'absolute',
                              bottom: -6,
                              left: -6,
                              backgroundColor: AppTheme.colors.primary,
                              borderRadius: 12,
                              padding: 4,
                              elevation: 3,
                              shadowColor: '#000',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.2,
                              shadowRadius: 3,
                            }}
                            onPress={() => {
                              setCropTarget('edit');
                              setCropIndex(idx);
                            }}
                          >
                            <Ionicons name="crop" size={16} color="#fff" />
                          </TouchableOpacity>
                        )}
                     </View>
                     );
                  })}
                  
                  {/* Option to add more photos while editing */}
                  {editFileType === 'image' && (
                     <TouchableOpacity onPress={() => handleTakePhoto(true)} style={styles.addMoreTile}>
                        <Ionicons name="camera" size={32} color={AppTheme.colors.primary} />
                        <Text style={{ color: AppTheme.colors.primary, marginTop: 8, fontSize: 12, fontWeight: 'bold' }}>Add Photo</Text>
                     </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}

            {/* Media buttons inside edit modal */}
            {editFileUris.length === 0 && (
              <View style={styles.mediaActions}>
                <TouchableOpacity onPress={() => handleTakePhoto(true)} style={styles.mediaButton}>
                  <Ionicons name="camera" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleGalleryPick(true)} style={styles.mediaButton}>
                  <Ionicons name="image" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleUploadFile(true)} style={styles.mediaButton}>
                  <Ionicons name="document-attach" size={20} color={AppTheme.colors.primary} />
                  <Text style={styles.mediaButtonText}>Files</Text>
                </TouchableOpacity>
              </View>
            )}
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => { 
                  setEditModalVisible(false); 
                  setEditingDoc(null);
                  setEditDocTitle(''); 
                  setEditDocContent(''); 
                  setEditFileUris([]); 
                  setEditFileType(null); 
                }} 
                style={[styles.button, { backgroundColor: AppTheme.colors.border }]} 
                disabled={isUpdating}
              >
                <Text style={[styles.buttonText, { color: AppTheme.colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSaveEditDoc} style={styles.button} disabled={isUpdating}>
                {isUpdating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* VIEW DOCUMENT MODAL (Popup) */}
      <Modal visible={viewModalVisible} animationType="slide" transparent={false}>
        <View style={styles.fullScreenModal}>
          
          <View style={styles.fullScreenHeader}>
            <Text style={styles.fullScreenTitle}>{selectedDoc?.title}</Text>
            <TouchableOpacity onPress={() => setViewModalVisible(false)} style={styles.closeButton}>
              <Ionicons name="close" size={26} color="#ffffff" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.fullScreenContent}>
            {decryptedArray.length === 0 && selectedDoc?.type !== 'text' ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={AppTheme.colors.primary} />
                <Text style={{ color: AppTheme.colors.textSecondary, marginTop: 12, fontWeight: '500' }}>Opening Document...</Text>
              </View>
            ) : selectedDoc?.type === 'image' ? (
               <ScrollView style={{ flex: 1 }}>
                  {decryptedArray.map((uri, idx) => {
                    const safeUri = getSafeImageUri(uri);
                    if (!safeUri) return null;
                    return (
                    <View key={idx} style={{ marginBottom: 20, position: 'relative' }}>
                      <Image source={{ uri: safeUri }} style={{ width: '100%', height: 600 }} resizeMode="contain" />
                      <TouchableOpacity 
                         onPress={() => handleDownloadFile(uri, selectedDoc.title, 'image', idx)} 
                         style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
                      >
                         <Ionicons name="download" size={20} color="#fff" />
                         <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Download Image</Text>
                      </TouchableOpacity>
                    </View>
                    );
                  })}
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
                 <ScrollView style={{ flex: 1 }}>
                    {decryptedArray.map((uri, idx) => (
                      <View key={idx} style={{ height: 600, marginBottom: 20 }}>
                         <WebView originWhitelist={['*']} source={{ uri }} style={{ flex: 1 }} nestedScrollEnabled />
                         <TouchableOpacity 
                            onPress={() => handleDownloadFile(uri, selectedDoc.title, 'pdf', idx)} 
                            style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
                         >
                            <Ionicons name="download" size={20} color="#fff" />
                            <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Open / Share PDF</Text>
                         </TouchableOpacity>
                      </View>
                    ))}
                 </ScrollView>
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
  docCard: { backgroundColor: AppTheme.colors.surface, padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.m, marginBottom: AppTheme.spacing.m, borderWidth: 1, borderColor: AppTheme.colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  docTitle: { color: AppTheme.colors.text, fontSize: 16, fontWeight: 'bold' },
  docDate: { color: AppTheme.colors.textSecondary, fontSize: 12, marginTop: 2 },
  docThumbBox: { width: 56, height: 56, borderRadius: 10, backgroundColor: 'rgba(6, 182, 212, 0.12)', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  typeBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(6, 182, 212, 0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginTop: 4 },
  typeBadgeText: { color: AppTheme.colors.primary, fontSize: 10, fontWeight: '700' },
  cardActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 2 },
  cardActionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2, paddingHorizontal: 6 },
  cardActionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 4 },
  cardActionText: { color: AppTheme.colors.primary, fontSize: 12, fontWeight: '600' },
  actionDivider: { width: 1, height: 14, backgroundColor: AppTheme.colors.border },
  emptyText: { color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40 },
  fab: { position: 'absolute', bottom: 30, left: 330, width: 60, height: 60, borderRadius: 30, backgroundColor: AppTheme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 5, zIndex: 10, shadowColor: AppTheme.colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: AppTheme.spacing.l },
  modalContent: { backgroundColor: 'rgba(255, 255, 255, 0.85)', padding: AppTheme.spacing.l, borderRadius: AppTheme.borderRadius.l, maxWidth: 600, width: '100%', alignSelf: 'center', borderWidth: 1, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: AppTheme.spacing.m },
  input: { backgroundColor: 'rgba(255, 255, 255, 0.6)', borderWidth: 1, borderColor: '#fff', color: AppTheme.colors.text, padding: 12, borderRadius: AppTheme.borderRadius.s, marginBottom: AppTheme.spacing.m, fontSize: 15, letterSpacing: 0 },
  mediaActions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: AppTheme.spacing.m },
  mediaButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.5)', borderWidth: 1, borderColor: AppTheme.colors.primary, padding: 10, borderRadius: AppTheme.borderRadius.s, marginHorizontal: 2 },
  mediaButtonText: { color: AppTheme.colors.primary, marginLeft: 4, fontWeight: '600', fontSize: 12 },
  
  // Multi-file thumbnails
  filePreviewContainer: { marginBottom: AppTheme.spacing.m },
  thumbnailWrapper: { position: 'relative', marginRight: 16, width: 120, height: 120, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8 },
  thumbnailImage: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m },
  thumbnailPdf: { width: 120, height: 120, backgroundColor: 'rgba(255, 255, 255, 0.6)', borderRadius: AppTheme.borderRadius.m, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#fff' },
  removeFileBtn: { position: 'absolute', top: -10, right: -10, backgroundColor: '#000', borderRadius: 12 },
  addMoreTile: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m, borderWidth: 1, borderColor: AppTheme.colors.primary, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.4)' },
  
  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: AppTheme.spacing.s },
  button: { flex: 1, backgroundColor: AppTheme.colors.primary, padding: 12, borderRadius: AppTheme.borderRadius.s, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  decryptedBox: { backgroundColor: 'rgba(255, 255, 255, 0.6)', padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.s, marginVertical: AppTheme.spacing.m, minHeight: 100 },
  decryptedText: { color: AppTheme.colors.text, fontSize: 16, lineHeight: 24 },
  
  fullScreenModal: { flex: 1, backgroundColor: 'rgba(234, 240, 248, 0.95)' }, // frosted glass overall
  fullScreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 40, backgroundColor: 'rgba(255, 255, 255, 0.3)' },
  fullScreenTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold' },
  closeButton: { padding: 6, backgroundColor: '#ef4444', borderRadius: 20, shadowColor: '#ef4444', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  fullScreenContent: { flex: 1, padding: 20 },
  fullScreenText: { color: AppTheme.colors.text, fontSize: 18, lineHeight: 28 }
});
