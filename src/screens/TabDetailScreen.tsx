import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator, Image, Platform, ScrollView, KeyboardAvoidingView, useWindowDimensions } from 'react-native';
import { useLockerStore } from '../store/useLockerStore';
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

export default function TabDetailScreen({ route, navigation }: any) {
  const tabId = route?.params?.tabId;
  const unlockPin = route?.params?.unlockPin;
  const { tabs, activeDocuments, loadDocumentsForTab, addDocument, updateDocument, deleteDocument, logout, currentUser } = useLockerStore();
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < 768;

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
  const lastTapRef = useRef<{ id: string | number; time: number } | null>(null);

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
          setCropTarget('edit');
          setCropIndex(newIndex);
        } else {
          const newIndex = fileUris.length;
          setFileUris(prev => [...prev, newUri]);
          setFileType('image');
          setCropTarget('add');
          setCropIndex(newIndex);
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
      setWebCameraVisible(false);
      setCropTarget('edit');
      setCropIndex(newIndex);
    } else {
      const newIndex = fileUris.length;
      setFileUris(prev => [...prev, optimized]);
      setFileType('image');
      setWebCameraVisible(false);
      setCropTarget('add');
      setCropIndex(newIndex);
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
          setCropTarget('edit');
          setCropIndex(newIndex);
        } else {
          const newIndex = fileUris.length;
          setFileUris(prev => [...prev, newUri]);
          setFileType('image');
          setCropTarget('add');
          setCropIndex(newIndex);
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
        } else {
          setFileType(determinedType as any);
          setFileUris(prev => [...prev, ...newUris]);
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
      } catch (e) { }
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const files = parsed.filter((item: any) => typeof item === 'string' && item.length > 0);
          return { notes: '', files };
        }
      } catch (e) { }
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
        const rawArr = parseDecryptedContent(plainText);
        if (rawArr.length > 0) {
          const effectiveType = doc.type === 'pdf' || (rawArr[0] && rawArr[0].includes('application/pdf')) ? 'pdf' : 'image';
          prepared = await prepareLocalFiles(rawArr, doc.title || 'doc', effectiveType);
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
    const rawArr = parseDecryptedContent(plainText);
    if (rawArr.length > 0) {
      const effectiveType = doc.type === 'pdf' || (rawArr[0] && rawArr[0].includes('application/pdf')) ? 'pdf' : 'image';
      arr = await prepareLocalFiles(rawArr, doc.title || 'doc', effectiveType);
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

  const getPdfBlobUrl = (uri: string): string => {
    if (!uri) return '';
    if (uri.startsWith('blob:')) return uri;
    try {
      let base64 = uri;
      let mime = 'application/pdf';
      if (uri.startsWith('data:')) {
        const parts = uri.split(',');
        const header = parts[0];
        base64 = parts[1] || parts[0];
        const mimeMatch = header.match(/data:([^;]+)/);
        if (mimeMatch) mime = mimeMatch[1];
      }
      const cleanBase64 = base64.replace(/[\s\r\n]/g, '');
      const binary = atob(cleanBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error('getPdfBlobUrl error:', e);
      return uri;
    }
  };

  const formatFileSize = (encryptedContent: string): string => {
    if (!encryptedContent) return '0 KB';
    const bytes = Math.round(encryptedContent.length * 0.75);
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.round(bytes / 1024)} KB`;
  };

  const calculateTotalSizeMB = (): string => {
    let totalBytes = 0;
    activeDocuments.forEach(doc => {
      if (doc.encryptedContent) {
        totalBytes += Math.round(doc.encryptedContent.length * 0.75);
      }
    });
    return (totalBytes / (1024 * 1024)).toFixed(1);
  };

  const handleItemPress = (item: any) => {
    const now = Date.now();
    if (lastTapRef.current && lastTapRef.current.id === item.id && (now - lastTapRef.current.time) < 350) {
      lastTapRef.current = null;
      handleViewDoc(item);
    } else {
      lastTapRef.current = { id: item.id, time: now };
      handleSelectPreview(item);
    }
  };

  const handleDeleteClick = (item: any) => {
    if (!item) return;
    const doDelete = () => {
      deleteDocument(item.id!, tabId);
      if (previewDoc?.id === item.id) {
        setPreviewDoc(null);
        setPreviewData('');
        setPreviewDataArray([]);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to delete "${item.title}"?`)) {
        doDelete();
      }
    } else {
      Alert.alert('Delete Document', `Are you sure you want to delete "${item.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete }
      ]);
    }
  };

  const currentTab = (tabs || []).find(t => t.uuid === tabId);
  const displayTabName = route?.params?.tabName || currentTab?.name || 'General Vault';
  const displayTabDesc = currentTab?.description || 'Default secure storage tab';

  return (
    <View style={styles.container}>
      {/* TOP HEADER BAR matching main app */}
      <View style={{
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: AppTheme.colors.primary,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 10,
          }}>
            <Ionicons name="lock-closed" size={18} color="#ffffff" />
          </View>
          <Text style={{ fontSize: 19, fontWeight: '700', color: AppTheme.colors.text }}>OfflineLocker</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={() => navigation.navigate('Dashboard')} 
            style={{ 
              flexDirection: 'row', 
              alignItems: 'center', 
              backgroundColor: AppTheme.colors.primaryLight, 
              paddingHorizontal: 14, 
              paddingVertical: 6, 
              borderRadius: 20, 
              borderWidth: 1, 
              borderColor: AppTheme.colors.primaryBorder, 
              marginRight: 12 
            }}
          >
            <Ionicons name="cloud-outline" size={18} color={AppTheme.colors.primary} style={{ marginRight: 6 }} />
            <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13 }}>Backup</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => logout()} style={{ padding: 4 }}>
            <Ionicons name="log-out-outline" size={22} color={AppTheme.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* VAULT TITLE & COUNTER HEADER (matching attached image) */}
      <View style={{ paddingHorizontal: isMobile ? 16 : 24, paddingTop: 16, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            style={{
              marginRight: 12,
              padding: 6,
            }}
          >
            <Ionicons name="chevron-back" size={22} color={AppTheme.colors.textSecondary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: isMobile ? 20 : 24, fontWeight: '700', color: AppTheme.colors.text, letterSpacing: -0.3 }}>
              {displayTabName}
            </Text>
            <Text style={{ fontSize: 14, color: AppTheme.colors.textSecondary, marginTop: 2 }}>
              {displayTabDesc}
            </Text>
            <View style={{ 
              alignSelf: 'flex-start', 
              backgroundColor: AppTheme.colors.primaryLight, 
              paddingHorizontal: 12, 
              paddingVertical: 4, 
              borderRadius: 16, 
              marginTop: 8 
            }}>
              <Text style={{ color: AppTheme.colors.primary, fontSize: 12, fontWeight: '600' }}>
                {activeDocuments.length} {activeDocuments.length === 1 ? 'item' : 'items'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* MAIN SPLIT CONTENT CARD (Left List + Right Preview) */}
      <View style={{ flex: 1, paddingHorizontal: isMobile ? 10 : 24, paddingBottom: 20 }}>
        <View style={{
          flex: 1,
          flexDirection: 'row',
          backgroundColor: '#ffffff',
          borderRadius: 20,
          borderWidth: 1,
          borderColor: '#f1f5f9',
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.03,
          shadowRadius: 12,
          elevation: 3,
        }}>

          {/* LEFT PANE: List of Documents ("All Files") */}
          <View style={{
            width: isMobile ? 165 : 360,
            borderRightWidth: 1,
            borderColor: '#e2e8f0',
            backgroundColor: '#ffffff',
            flexDirection: 'column',
          }}>
            <View style={{ paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#e2e8f0' }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.text }}>All Files</Text>
            </View>

            <FlatList
              data={activeDocuments}
              keyExtractor={item => item.id!.toString()}
              contentContainerStyle={{ padding: 8 }}
              renderItem={({ item }) => {
                const isSelected = previewDoc?.id === item.id;
                const thumbUri = getThumbnailForItem(item);
                const formattedDate = new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

                return (
                  <TouchableOpacity
                    style={{
                      backgroundColor: isSelected ? AppTheme.colors.primaryLight : '#ffffff',
                      padding: isMobile ? 8 : 12,
                      borderRadius: 12,
                      marginBottom: 6,
                      borderWidth: 1,
                      borderColor: isSelected ? AppTheme.colors.primaryBorder : 'transparent',
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                    onPress={() => handleItemPress(item)}
                    {...(Platform.OS === 'web' ? { onDoubleClick: () => handleViewDoc(item) } : {})}
                  >
                    {/* Icon / Thumbnail Box */}
                    <View style={{
                      width: isMobile ? 34 : 44,
                      height: isMobile ? 34 : 44,
                      borderRadius: 10,
                      backgroundColor: item.type === 'pdf' ? '#fee2e2' : item.type === 'image' ? '#e0e7ff' : '#f1f5f9',
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginRight: isMobile ? 8 : 12,
                      overflow: 'hidden',
                    }}>
                      {thumbUri ? (
                        <Image source={{ uri: thumbUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      ) : item.type === 'pdf' ? (
                        <Ionicons name="document-text" size={isMobile ? 18 : 22} color="#ef4444" />
                      ) : item.type === 'image' ? (
                        <Ionicons name="image" size={isMobile ? 18 : 22} color="#2563eb" />
                      ) : (
                        <Ionicons name="document-text" size={isMobile ? 18 : 22} color="#2563eb" />
                      )}
                    </View>

                    {/* Meta */}
                    <View style={{ flex: 1, marginRight: 4 }}>
                      <Text style={{ 
                        fontSize: isMobile ? 12 : 14, 
                        fontWeight: '700', 
                        color: AppTheme.colors.text 
                      }} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={{ 
                        fontSize: isMobile ? 10 : 12, 
                        color: AppTheme.colors.textSecondary, 
                        marginTop: 2 
                      }} numberOfLines={1}>
                        {formatFileSize(item.encryptedContent)} • {formattedDate}
                      </Text>
                    </View>

                    {/* Blue Selection Dot */}
                    {isSelected && (
                      <View style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: AppTheme.colors.primary,
                        marginLeft: 4,
                      }} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: AppTheme.colors.textSecondary, fontSize: 13, textAlign: 'center' }}>
                    No files found in this vault.
                  </Text>
                </View>
              }
            />

            <View style={{ padding: 10, borderTopWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}>
              <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary, textAlign: 'center' }}>
                {activeDocuments.length} items · {calculateTotalSizeMB()} MB
              </Text>
            </View>
          </View>

          {/* RIGHT PANE: File Preview & Details */}
          <View style={{ flex: 1, backgroundColor: '#ffffff', padding: isMobile ? 12 : 20 }}>
            {previewDoc ? (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {/* PREVIEW TOP BAR */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <Text style={{ fontSize: isMobile ? 16 : 20, fontWeight: '700', color: AppTheme.colors.text, flex: 1, marginRight: 10 }} numberOfLines={1}>
                    {previewDoc.title}
                  </Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {/* Open Button for ALL files */}
                    <TouchableOpacity 
                      onPress={() => handleViewDoc(previewDoc)}
                      style={{ 
                        flexDirection: 'row', 
                        alignItems: 'center', 
                        backgroundColor: AppTheme.colors.primaryLight, 
                        borderWidth: 1, 
                        borderColor: AppTheme.colors.primaryBorder, 
                        paddingHorizontal: 12, 
                        paddingVertical: 6, 
                        borderRadius: 8, 
                        marginRight: 8 
                      }}
                    >
                      <Ionicons name="eye-outline" size={16} color={AppTheme.colors.primary} style={{ marginRight: 4 }} />
                      <Text style={{ color: AppTheme.colors.primary, fontWeight: '600', fontSize: 13 }}>Open</Text>
                    </TouchableOpacity>

                    {(previewDoc.type === 'image' || previewDoc.type === 'pdf') && (
                      <TouchableOpacity 
                        onPress={handleDownloadSelected}
                        style={{ padding: 6, marginRight: 6 }}
                      >
                        <Ionicons name="download-outline" size={20} color={AppTheme.colors.primary} />
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity 
                      onPress={() => handleViewDoc(previewDoc)}
                      style={{ padding: 6, marginRight: 6 }}
                    >
                      <Ionicons name="expand-outline" size={20} color={AppTheme.colors.primary} />
                    </TouchableOpacity>

                    <TouchableOpacity 
                      onPress={() => handleDeleteClick(previewDoc)}
                      style={{ padding: 6 }}
                    >
                      <Ionicons name="trash-outline" size={20} color={AppTheme.colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* MAIN PREVIEW CANVAS */}
                <View style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  overflow: 'hidden',
                  minHeight: isMobile ? 220 : 360,
                  justifyContent: 'center',
                }}>
                  {previewDoc.type === 'image' && (
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
                      {previewDataArray.map((uri, idx) => {
                        const safeUri = getSafeImageUri(uri);
                        if (!safeUri) return null;
                        return (
                          <View key={idx} style={{ marginBottom: 12, alignItems: 'center' }}>
                            <Image 
                              source={{ uri: safeUri }} 
                              style={{ width: '100%', height: isMobile ? 240 : 380, borderRadius: 12 }} 
                              resizeMode="contain" 
                            />
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}

                  {previewDoc.type === 'text' && (
                    <ScrollView style={{ flex: 1, padding: 16 }}>
                      <Text style={{ color: AppTheme.colors.text, fontSize: 15, lineHeight: 24 }}>
                        {parseDecryptedPayload(previewData).notes || (previewData.startsWith('[') || previewData.startsWith('{') ? '' : previewData)}
                      </Text>
                    </ScrollView>
                  )}

                  {previewDoc.type === 'pdf' && Platform.OS === 'web' && (
                    <ScrollView style={{ flex: 1 }}>
                      {previewDataArray.map((uri, idx) => {
                        const blobUrl = getPdfBlobUrl(uri);
                        return (
                          <View key={idx} style={{ marginBottom: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e2e8f0' }}>
                            <View style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              backgroundColor: '#eef2ff',
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderBottomWidth: 1,
                              borderBottomColor: '#dbeafe'
                            }}>
                              <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.primary }}>
                                PDF Document ({idx + 1}/{previewDataArray.length})
                              </Text>
                            </View>

                            <View style={{ height: isMobile ? 320 : 500, backgroundColor: '#ffffff' }}>
                              {React.createElement('embed', {
                                src: blobUrl,
                                type: 'application/pdf',
                                style: { width: '100%', height: '100%', border: 'none' },
                              })}
                            </View>
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}

                  {previewDoc.type === 'pdf' && Platform.OS !== 'web' && (
                    <ScrollView style={{ flex: 1 }}>
                      {previewDataArray.map((uri, idx) => (
                        <View key={idx} style={{ height: isMobile ? 300 : 480, marginBottom: 12 }}>
                          <WebView originWhitelist={['*']} source={{ uri }} style={{ flex: 1, borderRadius: 12 }} />
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>

                {/* DETAILS SECTION UNDERNEATH PREVIEW */}
                <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderColor: '#e2e8f0' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: AppTheme.colors.text, marginBottom: 12 }}>
                    Details
                  </Text>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <View style={{ width: '33%', marginBottom: 14 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Type</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }}>
                        {previewDoc.type === 'image' ? 'JPEG Image' : previewDoc.type === 'pdf' ? 'PDF Document' : 'Text Document'}
                      </Text>
                    </View>

                    <View style={{ width: '33%', marginBottom: 14 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Size</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }}>
                        {formatFileSize(previewDoc.encryptedContent)}
                      </Text>
                    </View>

                    <View style={{ width: '33%', marginBottom: 14 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Dimensions</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }}>
                        {previewDoc.type === 'image' ? 'Image File' : previewDoc.type === 'pdf' ? 'PDF Document' : 'Text File'}
                      </Text>
                    </View>

                    <View style={{ width: '50%', marginBottom: 10 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Date Modified</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }}>
                        {new Date(previewDoc.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>

                    <View style={{ width: '50%', marginBottom: 10 }}>
                      <Text style={{ fontSize: 11, color: AppTheme.colors.textSecondary }}>Path</Text>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: AppTheme.colors.text, marginTop: 2 }} numberOfLines={1}>
                        /{displayTabName}/{previewDoc.title}
                      </Text>
                    </View>
                  </View>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.center}>
                <Ionicons name="document-text-outline" size={72} color={AppTheme.colors.border} />
                <Text style={{ color: AppTheme.colors.textSecondary, marginTop: 16, fontSize: 15, fontWeight: '500', textAlign: 'center' }}>
                  Select a document to preview
                </Text>
              </View>
            )}
          </View>

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

            <TextInput style={[styles.input, { height: 90, textAlignVertical: 'top', letterSpacing: 0 }]} placeholder="Description / Notes" placeholderTextColor={AppTheme.colors.textSecondary} value={docContent} onChangeText={setDocContent} multiline />

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
                        {fileType === 'image' && safeUri && (
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
              placeholder="Description / Notes"
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
                        {editFileType === 'image' && safeUri && (
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
            {(() => {
              const { notes, files } = parseDecryptedPayload(decryptedText);
              const displayFiles = decryptedArray.length > 0 ? decryptedArray : files;
              const isPdf = selectedDoc?.type === 'pdf' || (displayFiles[0] && (displayFiles[0].includes('application/pdf') || displayFiles[0].endsWith('.pdf')));

              return (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
                  {!!notes && (
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.85)', padding: 18, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: AppTheme.colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}>
                      <Text style={{ fontSize: 13, color: AppTheme.colors.primary, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Description / Notes</Text>
                      <Text style={{ fontSize: 16, color: AppTheme.colors.text, lineHeight: 24 }}>{notes}</Text>
                    </View>
                  )}

                  {displayFiles.length > 0 && !isPdf && (
                    displayFiles.map((uri, idx) => {
                      const safeUri = getSafeImageUri(uri);
                      if (!safeUri) return null;
                      return (
                        <View key={idx} style={{ marginBottom: 20, position: 'relative' }}>
                          <Image source={{ uri: safeUri }} style={{ width: '100%', height: 500, borderRadius: 12 }} resizeMode="contain" />
                          <TouchableOpacity
                            onPress={() => handleDownloadFile(uri, selectedDoc.title, 'image', idx)}
                            style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
                          >
                            <Ionicons name="download" size={20} color="#fff" />
                            <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Download Image</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })
                  )}

                  {displayFiles.length > 0 && isPdf && (
                    Platform.OS === 'web' ? (
                      displayFiles.map((uri, idx) => {
                        const blobUrl = getPdfBlobUrl(uri);
                        return (
                          <View key={idx} style={{ height: 750, marginBottom: 20 }}>
                            {React.createElement('object', {
                              data: blobUrl,
                              type: 'application/pdf',
                              style: { width: '100%', height: '100%', border: 'none', borderRadius: 12 }
                            }, React.createElement('iframe', {
                              src: blobUrl,
                              style: { width: '100%', height: '100%', border: 'none', borderRadius: 12 },
                              title: `${selectedDoc?.title} ${idx + 1}`
                            }))}
                          </View>
                        );
                      })
                    ) : (
                      displayFiles.map((uri, idx) => (
                        <View key={idx} style={{ height: 600, marginBottom: 20 }}>
                          <WebView originWhitelist={['*']} source={{ uri }} style={{ flex: 1, borderRadius: 12 }} nestedScrollEnabled />
                          <TouchableOpacity
                            onPress={() => handleDownloadFile(uri, selectedDoc.title, 'pdf', idx)}
                            style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center' }}
                          >
                            <Ionicons name="download" size={20} color="#fff" />
                            <Text style={{ color: '#fff', marginLeft: 6, fontWeight: 'bold' }}>Open / Share PDF</Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )
                  )}

                  {displayFiles.length === 0 && !notes && (
                    <Text style={{ color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>No description or file content found.</Text>
                  )}
                </ScrollView>
              );
            })()}
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
  docCard: { 
    backgroundColor: '#ffffff', 
    padding: AppTheme.spacing.m, 
    borderRadius: AppTheme.borderRadius.l, 
    marginBottom: AppTheme.spacing.m, 
    borderWidth: 1, 
    borderColor: '#f1f5f9', 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.03, 
    shadowRadius: 12, 
    elevation: 2 
  },
  docTitle: { color: AppTheme.colors.text, fontSize: 17, fontWeight: '700' },
  docDate: { color: AppTheme.colors.textSecondary, fontSize: 13, marginTop: 4 },
  docThumbBox: { width: 56, height: 56, borderRadius: 14, backgroundColor: AppTheme.colors.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 14, overflow: 'hidden' },
  typeBadge: { alignSelf: 'flex-start', backgroundColor: AppTheme.colors.primaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, marginTop: 6 },
  typeBadgeText: { color: AppTheme.colors.primary, fontSize: 11, fontWeight: '700' },
  cardActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  cardActionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  cardActionBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: AppTheme.colors.primaryLight, borderRadius: 8 },
  cardActionText: { color: AppTheme.colors.primary, fontSize: 13, fontWeight: '600' },
  actionDivider: { width: 1, height: 16, backgroundColor: '#e2e8f0' },
  emptyText: { color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 40, fontSize: 15 },
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: AppTheme.colors.primary, justifyContent: 'center', alignItems: 'center', elevation: 6, zIndex: 10, shadowColor: AppTheme.colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', justifyContent: 'center', padding: AppTheme.spacing.l },
  modalContent: { backgroundColor: '#ffffff', padding: AppTheme.spacing.l, borderRadius: AppTheme.borderRadius.xl, maxWidth: 600, width: '100%', alignSelf: 'center', borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.08, shadowRadius: 24, elevation: 6 },
  modalTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: AppTheme.spacing.m },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', color: AppTheme.colors.text, padding: 14, borderRadius: AppTheme.borderRadius.s, marginBottom: AppTheme.spacing.m, fontSize: 15, letterSpacing: 0 },
  mediaActions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: AppTheme.spacing.m },
  mediaButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: AppTheme.colors.primaryLight, borderWidth: 1, borderColor: AppTheme.colors.primaryBorder, padding: 12, borderRadius: AppTheme.borderRadius.s, marginHorizontal: 2 },
  mediaButtonText: { color: AppTheme.colors.primary, marginLeft: 6, fontWeight: '600', fontSize: 13 },

  // Multi-file thumbnails
  filePreviewContainer: { marginBottom: AppTheme.spacing.m },
  thumbnailWrapper: { position: 'relative', marginRight: 16, width: 120, height: 120, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8 },
  thumbnailImage: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m },
  thumbnailPdf: { width: 120, height: 120, backgroundColor: '#f8fafc', borderRadius: AppTheme.borderRadius.m, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e2e8f0' },
  removeFileBtn: { position: 'absolute', top: -10, right: -10, backgroundColor: '#ef4444', borderRadius: 12 },
  addMoreTile: { width: 120, height: 120, borderRadius: AppTheme.borderRadius.m, borderWidth: 1.5, borderColor: AppTheme.colors.primary, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: AppTheme.colors.primaryLight },

  modalActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: AppTheme.spacing.s },
  button: { flex: 1, backgroundColor: AppTheme.colors.primary, paddingVertical: 14, borderRadius: AppTheme.borderRadius.s, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  decryptedBox: { backgroundColor: '#f8fafc', padding: AppTheme.spacing.m, borderRadius: AppTheme.borderRadius.s, marginVertical: AppTheme.spacing.m, minHeight: 100, borderWidth: 1, borderColor: '#e2e8f0' },
  decryptedText: { color: AppTheme.colors.text, fontSize: 16, lineHeight: 24 },

  fullScreenModal: { flex: 1, backgroundColor: AppTheme.colors.background },
  fullScreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 40, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  fullScreenTitle: { color: AppTheme.colors.text, fontSize: 20, fontWeight: 'bold' },
  closeButton: { padding: 6, backgroundColor: '#ef4444', borderRadius: 20, shadowColor: '#ef4444', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
  fullScreenContent: { flex: 1, padding: 20 },
  fullScreenText: { color: AppTheme.colors.text, fontSize: 18, lineHeight: 28 }
});
