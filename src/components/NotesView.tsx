import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLockerStore } from '../store/useLockerStore';
import { Note } from '../models';
import { AppTheme, getPageColor, PAGE_COLORS, CUSTOM_KEY, DEFAULT_PAGE_COLOR_KEY } from '../theme/AppTheme';
import ColorPickerModal from './ColorPickerModal';
import DraggableFAB from './DraggableFAB';
import BiometricToggle, { BiometricUnlockButton } from './BiometricToggle';
import { BiometricService, BiometricScopes } from '../services/BiometricService';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { withoutAutoLock } from '../services/AutoLockService';
import { ensureDecryptedCacheDir } from '../services/FileCacheService';
import { buildTextPdf } from '../services/PdfBuilder';
import { useTextHistory } from '../hooks/useTextHistory';
import ModalCloseButton from './ModalCloseButton';

interface NotesViewProps {
  isMobile: boolean;
}

type PinAction = 'open' | 'edit' | 'delete';

const formatStamp = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function NotesView({ isMobile }: NotesViewProps) {
  const { currentUser, notes, loadNotes, addNote, updateNote, deleteNote, decryptNote, verifyNotePin, notePageColor, customNotePageColor, loadPageColors, setNotePageColor, setCustomNotePageColor } = useLockerStore();
  const paper = getPageColor(notePageColor, customNotePageColor);
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');

  // Step 1 — the note's name and protection
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsNote, setDetailsNote] = useState<Note | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSensitive, setDraftSensitive] = useState(false);
  const [draftPin, setDraftPin] = useState('');
  const [draftConfirmPin, setDraftConfirmPin] = useState('');
  const [draftBiometric, setDraftBiometric] = useState(false);

  // Step 2 — writing the note itself
  const [paperVisible, setPaperVisible] = useState(false);
  const [paperPickerVisible, setPaperPickerVisible] = useState(false);
  const [shareChoiceVisible, setShareChoiceVisible] = useState(false);
  // Both pickers open from the writer while it may still hold the keyboard,
  // which would sit over them
  useEffect(() => {
    if (paperVisible || shareChoiceVisible) Keyboard.dismiss();
  }, [paperVisible, shareChoiceVisible]);
  const [writerNote, setWriterNote] = useState<Note | null>(null);
  const [writerBody, setWriterBody] = useState('');
  // Read by the close handler, which must not depend on a stale render
  const writerBodyRef = useRef(writerBody);
  useEffect(() => { writerBodyRef.current = writerBody; }, [writerBody]);
  // A note saves itself, so a deletion is on disk almost at once. This is what
  // stands in for the Save button the writer deliberately does not have.
  const history = useTextHistory(setWriterBody);

  const [isSaving, setIsSaving] = useState(false);

  // Notes unlocked during this session, so the PIN is asked once rather than per action
  // Only the note currently open is unlocked, and only until it is closed.
  // Anything longer-lived would leave a PIN-protected note readable for the
  // rest of the session.
  const [unlockedId, setUnlockedId] = useState<number | null>(null);
  const [pinModalNote, setPinModalNote] = useState<Note | null>(null);
  const [pinAction, setPinAction] = useState<PinAction>('open');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  // Whether the note in the PIN window can also be opened with a scan
  const [noteBiometricOn, setNoteBiometricOn] = useState(false);

  /** Matches the Cancel button: the typed PIN never outlives the window. */
  const closePinModal = () => {
    setPinModalNote(null);
    setPinInput('');
    setPinError('');
  };

  useEffect(() => {
    loadNotes();
    loadPageColors();
  }, []);

  const isUnlocked = (note: Note) => !note.isSensitive || (note.id != null && note.id === unlockedId);

  // Search runs over decrypted text, so it happens here rather than in SQL.
  // Locked notes match on title only — their body must stay hidden.
  const visibleNotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter(n => {
      if (n.title.toLowerCase().includes(term)) return true;
      if (!isUnlocked(n)) return false;
      return decryptNote(n).toLowerCase().includes(term);
    });
  }, [notes, search, decryptNote, unlockedId]);

  const openDetails = (note: Note | null) => {
    setDetailsNote(note);
    setDraftTitle(note ? note.title : '');
    setDraftSensitive(note ? note.isSensitive === 1 : false);
    setDraftPin('');
    setDraftConfirmPin('');
    setDraftBiometric(false);
    if (note?.id != null) {
      BiometricService.isEnabled(currentUser?.uuid, BiometricScopes.note(note.id)).then(setDraftBiometric);
    }
    setDetailsVisible(true);
  };

  /**
   * Leaving a note saves it and re-locks it. There is no Save button; the
   * diary writes the same way, so the two behave alike.
   */
  /**
   * Sends the open note out as a PDF or as a plain text file. What is on screen
   * is written to disk first: the note saves on blur, and sharing does not blur.
   */
  const shareWriterNote = async (asPdf: boolean) => {
    const note = writerNote;
    if (!note) return;
    const title = note.title || 'Note';
    const body = writerBodyRef.current || '';
    await persistWriter();

    const safeTitle = title.replace(/[^a-z0-9]/gi, '_') || 'note';
    try {
      if (Platform.OS === 'web') {
        const blob = asPdf
          ? new Blob([Uint8Array.from(atob(buildTextPdf(title, body)), c => c.charCodeAt(0))], { type: 'application/pdf' })
          : new Blob([`${title}\n\n${body}`], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeTitle}.${asPdf ? 'pdf' : 'txt'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }

      const target = `${await ensureDecryptedCacheDir()}${safeTitle}.${asPdf ? 'pdf' : 'txt'}`;
      if (asPdf) {
        await FileSystem.writeAsStringAsync(target, buildTextPdf(title, body), { encoding: 'base64' });
      } else {
        await FileSystem.writeAsStringAsync(target, `${title}\n\n${body}`, { encoding: 'utf8' });
      }
      await withoutAutoLock(() => Sharing.shareAsync(target, {
        mimeType: asPdf ? 'application/pdf' : 'text/plain',
        dialogTitle: title,
        UTI: asPdf ? 'com.adobe.pdf' : 'public.plain-text',
      }));
    } catch (error) {
      console.warn('Share note failed:', error);
      Alert.alert('Could not share', 'The note could not be prepared for sharing.');
    }
  };

  const closeWriter = async () => {
    const note = writerNote;
    const body = writerBodyRef.current;
    setWriterNote(null);
    setWriterBody('');
    history.reset('');
    setUnlockedId(null);
    if (note?.id) {
      await updateNote(note.id, note.title, body, note.isSensitive === 1, undefined);
    }
  };

  /** Also written on blur, so a backgrounded app does not lose the text. */
  const persistWriter = async () => {
    const note = writerNote;
    if (!note?.id) return;
    await updateNote(note.id, note.title, writerBodyRef.current, note.isSensitive === 1, undefined);
  };

  const closeDetails = () => {
    setDetailsVisible(false);
    setDetailsNote(null);
    setUnlockedId(null);
  };

  const openWriter = (note: Note) => {
    const body = decryptNote(note);
    setWriterNote(note);
    setWriterBody(body);
    history.reset(body);
  };

  /** Runs `action` straight away for an open note, or asks for the PIN first. */
  const requirePin = async (note: Note, action: PinAction, run: () => void) => {
    if (isUnlocked(note)) {
      run();
      return;
    }
    // Biometrics first; the PIN window only when that is off, cancelled or fails
    const enabled = note.id != null && await BiometricService.isEnabled(currentUser?.uuid, BiometricScopes.note(note.id));
    setNoteBiometricOn(enabled);
    if (enabled && await tryNoteBiometric(note, action)) return;
    setPinModalNote(note);
    setPinAction(action);
    setPinInput('');
    setPinError('');
  };

  /** What happens once the note's PIN, or a scan standing in for it, has been accepted. */
  const proceedWithNote = (note: Note, action: PinAction) => {
    if (note.id != null) setUnlockedId(note.id);
    setPinModalNote(null);
    setPinInput('');
    setPinError('');

    if (action === 'edit') openDetails(note);
    else if (action === 'delete') confirmDelete(note);
    else openWriter(note);
  };

  const tryNoteBiometric = async (note: Note, action: PinAction): Promise<boolean> => {
    if (note.id == null) return false;
    const verb = action === 'edit' ? 'edit' : action === 'delete' ? 'delete' : 'unlock';
    const ok = await BiometricService.unlock(currentUser?.uuid, BiometricScopes.note(note.id), `Verify to ${verb} ${note.title}`);
    if (!ok) return false;
    proceedWithNote(note, action);
    return true;
  };

  const handlePinSubmit = () => {
    if (!pinModalNote) return;
    if (!verifyNotePin(pinModalNote, pinInput)) {
      setPinError('Incorrect PIN. Please try again.');
      setPinInput('');
      return;
    }
    proceedWithNote(pinModalNote, pinAction);
  };

  const confirmDelete = (note: Note) => {
    Alert.alert('Delete Note', `Are you sure you want to delete "${note.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (note.id) await deleteNote(note.id);
        },
      },
    ]);
  };

  /** Saves the name and protection. The body is written separately, afterwards. */
  const handleSaveDetails = async () => {
    const title = draftTitle.trim();
    if (!title) {
      Alert.alert('Name required', 'Please give the note a name.');
      return;
    }
    if (draftSensitive) {
      const needsPin = !detailsNote?.notePinHash || !!draftPin;
      if (needsPin) {
        if (draftPin.length !== 4) {
          Alert.alert('PIN required', 'Please set a 4-digit PIN for this note.');
          return;
        }
        if (draftPin !== draftConfirmPin) {
          Alert.alert('PINs do not match', 'The PIN and its confirmation must be the same.');
          return;
        }
      }
    }
    if (isSaving) return;
    setIsSaving(true);
    try {
      let keepUnlocked: number | null = null;
      if (detailsNote?.id) {
        // Renaming must not disturb the body, so it is re-saved as-is
        await updateNote(detailsNote.id, title, decryptNote(detailsNote), draftSensitive, draftPin || undefined, draftSensitive && draftBiometric);
      } else {
        const createdId = await addNote(title, '', draftSensitive, draftPin || undefined, draftSensitive && draftBiometric);
        // The PIN was just chosen, so writing the new note straight away does
        // not ask for it again — closing that writer re-locks as usual
        if (draftSensitive && createdId != null) keepUnlocked = createdId;
      }
      setDetailsVisible(false);
      setDetailsNote(null);
      setDraftTitle('');
      setDraftSensitive(false);
      setDraftPin('');
      setDraftConfirmPin('');
      setDraftBiometric(false);
      setUnlockedId(keepUnlocked);
    } finally {
      setIsSaving(false);
    }
  };

  const renderList = () => (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12 }}>
        {/* The page-colour control sits at the end of this row, where the diary
            keeps its own rather than on a line of its own */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#f8fafc',
              borderWidth: 1,
              borderColor: '#e2e8f0',
              borderRadius: 10,
              paddingHorizontal: 10,
            }}
          >
            <Ionicons name="search" size={15} color="#94a3b8" />
            <TextInput
              style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 8, fontSize: 13, color: AppTheme.colors.text }}
              placeholder="Search notes"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={15} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            onPress={() => setPaperVisible(true)}
            accessibilityLabel="Note page colour"
            style={{
              width: 38,
              height: 38,
              marginLeft: 8,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: paper.rule,
              backgroundColor: paper.paper,
            }}
          >
            <Ionicons name="color-palette-outline" size={18} color={AppTheme.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={visibleNotes}
        keyExtractor={item => String(item.id)}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={7}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 90 }}
        renderItem={({ item }) => {
          const locked = !isUnlocked(item);
          const preview = locked ? '' : decryptNote(item).replace(/\s+/g, ' ').trim();
          return (
            <TouchableOpacity
              onPress={() => requirePin(item, 'open', () => openWriter(item))}
              style={{
                backgroundColor: '#ffffff',
                borderWidth: 1,
                borderColor: '#e2e8f0',
                borderRadius: 12,
                padding: 12,
                marginBottom: 8,
                flexDirection: 'row',
                alignItems: 'center',
              }}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons
                    name={item.isSensitive === 1 ? (locked ? 'lock-closed' : 'lock-open') : 'document-text-outline'}
                    size={15}
                    color={item.isSensitive === 1 ? '#f59e0b' : AppTheme.colors.primary}
                  />
                  <Text
                    style={{ flex: 1, marginLeft: 8, fontSize: 13.5, fontWeight: '700', color: AppTheme.colors.text }}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                </View>
                {locked ? (
                  <Text style={{ fontSize: 11.5, color: '#b45309', marginTop: 5, fontStyle: 'italic' }}>
                    Locked — tap to enter the PIN
                  </Text>
                ) : preview ? (
                  <Text style={{ fontSize: 11.5, color: AppTheme.colors.textSecondary, marginTop: 5 }} numberOfLines={2}>
                    {preview}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 5, fontStyle: 'italic' }}>
                    Empty — tap to write
                  </Text>
                )}
                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>{formatStamp(item.updatedAt)}</Text>
              </View>

              <TouchableOpacity
                onPress={() => requirePin(item, 'edit', () => openDetails(item))}
                style={{ padding: 7 }}
              >
                <Ionicons name="create-outline" size={18} color={AppTheme.colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => requirePin(item, 'delete', () => confirmDelete(item))}
                style={{ padding: 7 }}
              >
                <Ionicons name="trash-outline" size={17} color="#ef4444" />
              </TouchableOpacity>
              <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 16,
                backgroundColor: '#f1f5f9',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <Ionicons name="document-text-outline" size={24} color="#94a3b8" />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.text }}>
              {search ? 'No matching notes' : 'No notes yet'}
            </Text>
            <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
              {search
                ? 'Try a different search term.'
                : 'Tap + to name a note, then open it to write.'}
            </Text>
          </View>
        }
      />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {renderList()}

      {/* Its own storage key, so moving it here does not move the one in Files */}
      <DraggableFAB
        onPress={() => openDetails(null)}
        storageKey="@offline_locker_fab_position_notes"
        initialBottom={18}
        initialRight={18}
        title="New Note"
      />

      {/* STEP 1 — name and protection */}
      <Modal visible={detailsVisible} transparent animationType="fade" onRequestClose={closeDetails}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 18 }}
        >
          <View style={{ backgroundColor: '#ffffff', borderRadius: 18, maxHeight: '90%' }}>
            {/* Scrollable so the buttons stay reachable once the keyboard is up */}
            <ScrollView
              contentContainerStyle={{ padding: 18 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 4, flex: 1 }}>
                  {detailsNote ? 'Edit Note' : 'New Note'}
                </Text>
                <ModalCloseButton onPress={closeDetails} />
              </View>
              <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, marginBottom: 14 }}>
                {detailsNote ? 'Rename it or change its PIN.' : 'Name it now — you write the note itself afterwards.'}
              </Text>

              <TextInput
                style={{
                  backgroundColor: '#f8fafc',
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  borderRadius: 10,
                  padding: 13,
                  fontSize: 14,
                  color: AppTheme.colors.text,
                  marginBottom: 12,
                }}
                placeholder="Note name"
                placeholderTextColor={AppTheme.colors.textSecondary}
                value={draftTitle}
                onChangeText={setDraftTitle}
                autoFocus={!detailsNote}
              />

              <TouchableOpacity
                onPress={() => setDraftSensitive(!draftSensitive)}
                style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={draftSensitive ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={AppTheme.colors.primary}
                />
                <Text style={{ marginLeft: 10, fontSize: 14, fontWeight: '600', color: AppTheme.colors.text }}>
                  Sensitive Note (Requires PIN)
                </Text>
              </TouchableOpacity>

              {draftSensitive && (
                <>
                  {!!detailsNote?.notePinHash && (
                    <Text style={{ fontSize: 11.5, color: AppTheme.colors.textSecondary, marginBottom: 8 }}>
                      This note already has a PIN. Leave these blank to keep it.
                    </Text>
                  )}
                  <TextInput
                    style={{
                      backgroundColor: '#f8fafc',
                      borderWidth: 1,
                      borderColor: '#e2e8f0',
                      borderRadius: 10,
                      padding: 13,
                      fontSize: 14,
                      color: AppTheme.colors.text,
                      marginBottom: 10,
                      letterSpacing: draftPin ? 6 : 0,
                    }}
                    placeholder="4-Digit Note PIN"
                    placeholderTextColor={AppTheme.colors.textSecondary}
                    value={draftPin}
                    onChangeText={t => setDraftPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={4}
                  />
                  <TextInput
                    style={{
                      backgroundColor: '#f8fafc',
                      borderWidth: 1,
                      borderColor:
                        draftPin.length === 4 && draftConfirmPin.length === 4 && draftPin !== draftConfirmPin
                          ? AppTheme.colors.error
                          : '#e2e8f0',
                      borderRadius: 10,
                      padding: 13,
                      fontSize: 14,
                      color: AppTheme.colors.text,
                      marginBottom: 10,
                      letterSpacing: draftConfirmPin ? 6 : 0,
                    }}
                    placeholder="Confirm 4-Digit Note PIN"
                    placeholderTextColor={AppTheme.colors.textSecondary}
                    value={draftConfirmPin}
                    onChangeText={t => setDraftConfirmPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={4}
                  />
                  {draftPin.length === 4 && draftConfirmPin.length === 4 && draftPin !== draftConfirmPin && (
                    <Text style={{ color: AppTheme.colors.error, fontSize: 12, marginBottom: 8, fontWeight: '600' }}>
                      Note PIN and Confirm PIN do not match.
                    </Text>
                  )}
                  <BiometricToggle value={draftBiometric} onChange={setDraftBiometric} />
                </>
              )}

              <View style={{ flexDirection: 'row', marginTop: 4 }}>
                <TouchableOpacity
                  onPress={closeDetails}
                  style={{
                    flex: 1,
                    paddingVertical: 13,
                    borderRadius: 10,
                    backgroundColor: AppTheme.colors.border,
                    alignItems: 'center',
                    marginRight: 8,
                  }}
                  disabled={isSaving}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.primary }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveDetails}
                  style={{
                    flex: 1,
                    paddingVertical: 13,
                    borderRadius: 10,
                    backgroundColor: AppTheme.colors.primary,
                    alignItems: 'center',
                    opacity: isSaving ? 0.6 : 1,
                  }}
                  disabled={isSaving}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#ffffff' }}>
                    {isSaving ? 'Saving…' : detailsNote ? 'Save Changes' : 'Create Note'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* STEP 2 — writing. Full screen, with Save in the top bar so the keyboard can never cover it. */}
      <Modal visible={!!writerNote} animationType="slide" onRequestClose={closeWriter}>
        <View style={{ flex: 1, backgroundColor: paper.paper, paddingTop: insets.top }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderBottomWidth: 1,
              borderBottomColor: paper.rule,
            }}
          >
            <TouchableOpacity onPress={closeWriter} style={{ padding: 6 }}>
              <Ionicons name="close" size={22} color={AppTheme.colors.text} />
            </TouchableOpacity>
            <Text
              style={{ flex: 1, marginHorizontal: 8, fontSize: 15, fontWeight: '800', color: AppTheme.colors.text }}
              numberOfLines={1}
            >
              {writerNote?.title}
            </Text>
            <TouchableOpacity
              onPress={history.undo}
              disabled={!history.canUndo}
              style={{ padding: 6, opacity: history.canUndo ? 1 : 0.3 }}
              accessibilityLabel="Undo the last change"
            >
              <Ionicons name="arrow-undo-outline" size={20} color={AppTheme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={history.redo}
              disabled={!history.canRedo}
              style={{ padding: 6, opacity: history.canRedo ? 1 : 0.3 }}
              accessibilityLabel="Redo the change that was undone"
            >
              <Ionicons name="arrow-redo-outline" size={20} color={AppTheme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShareChoiceVisible(true)}
              style={{ padding: 6 }}
              accessibilityLabel="Share this note"
            >
              <Ionicons name="share-social-outline" size={20} color={AppTheme.colors.primary} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={[
              {
                flex: 1,
                padding: 16,
                fontSize: 14.5,
                lineHeight: 22,
                color: AppTheme.colors.text,
                textAlignVertical: 'top',
              },
              // The browser's focus ring reads as a stray black box on web
              Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null,
            ]}
            placeholder="Write your note…"
            placeholderTextColor="#94a3b8"
            value={writerBody}
            onChangeText={text => { history.record(text); setWriterBody(text); }}
            onBlur={persistWriter}
            multiline
            autoFocus
          />
        </View>
      </Modal>

      {/* HOW TO SHARE THE OPEN NOTE */}
      <Modal
        visible={shareChoiceVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setShareChoiceVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 18 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 18, padding: 18, maxHeight: '90%', maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            <ScrollView contentContainerStyle={{ paddingBottom: 2 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 4, flex: 1 }} numberOfLines={2}>
                Share note
              </Text>
              <ModalCloseButton onPress={() => setShareChoiceVisible(false)} />
            </View>
            <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, marginBottom: 14 }} numberOfLines={2}>
              {writerNote?.title}
            </Text>

            {[
              {
                key: 'pdf',
                icon: 'document-text-outline' as const,
                title: 'As a PDF',
                subtitle: 'Reads the same anywhere',
                asPdf: true,
              },
              {
                key: 'text',
                icon: 'text-outline' as const,
                title: 'As plain text',
                subtitle: 'A .txt file anything can open',
                asPdf: false,
              },
            ].map(option => (
              <TouchableOpacity
                key={option.key}
                onPress={() => { setShareChoiceVisible(false); shareWriterNote(option.asPdf); }}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 13,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#e2e8f0',
                  backgroundColor: '#f8fafc',
                  marginBottom: 10,
                }}
              >
                <View style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: AppTheme.colors.primaryLight,
                  marginRight: 11,
                }}>
                  <Ionicons name={option.icon} size={18} color={AppTheme.colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.text }}>{option.title}</Text>
                  <Text style={{ fontSize: 11.5, color: AppTheme.colors.textSecondary, marginTop: 2 }}>{option.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={AppTheme.colors.textMuted} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={() => setShareChoiceVisible(false)}
              style={{ paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: AppTheme.colors.primary, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PAGE COLOUR */}
      <Modal visible={paperVisible} transparent animationType="fade" onRequestClose={() => setPaperVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 18 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 18, padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 4, flex: 1 }}>
                Page colour
              </Text>
              <ModalCloseButton onPress={() => setPaperVisible(false)} />
            </View>
            <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, marginBottom: 14 }}>
              The paper every note is written on.
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {PAGE_COLORS.map(option => {
                const isChosen = option.key === notePageColor;
                return (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => setNotePageColor(option.key)}
                    style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                    accessibilityLabel={option.label}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: option.paper,
                        borderWidth: isChosen ? 2 : 1,
                        borderColor: isChosen ? AppTheme.colors.primary : option.rule,
                      }}
                    >
                      {isChosen && <Ionicons name="checkmark" size={13} color={AppTheme.colors.primary} />}
                    </View>
                    <Text style={{ fontSize: 10, color: AppTheme.colors.textSecondary, marginTop: 4 }} numberOfLines={1}>
                      {option.label}
                    </Text>
                    {option.key === DEFAULT_PAGE_COLOR_KEY && (
                      <Text style={{ fontSize: 8.5, fontWeight: '600', color: AppTheme.colors.textMuted, marginTop: 1 }}>
                        Default
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              {/* Whatever the user mixed; tapping it again reopens the mixer */}
              <TouchableOpacity
                onPress={() => {
                  if (notePageColor !== CUSTOM_KEY) setNotePageColor(CUSTOM_KEY);
                  setPaperPickerVisible(true);
                }}
                style={{ width: '20%', alignItems: 'center', marginBottom: 10 }}
                accessibilityLabel="Custom page colour"
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: getPageColor(CUSTOM_KEY, customNotePageColor).paper,
                    borderWidth: notePageColor === CUSTOM_KEY ? 2 : 1,
                    borderColor: notePageColor === CUSTOM_KEY
                      ? AppTheme.colors.primary
                      : getPageColor(CUSTOM_KEY, customNotePageColor).rule,
                  }}
                >
                  <Ionicons
                    name={notePageColor === CUSTOM_KEY ? 'brush' : 'color-palette-outline'}
                    size={13}
                    color={AppTheme.colors.primary}
                  />
                </View>
                <Text style={{ fontSize: 10, color: AppTheme.colors.textSecondary, marginTop: 4 }} numberOfLines={1}>
                  Custom
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setPaperVisible(false)}
              style={{
                alignSelf: 'flex-end',
                paddingHorizontal: 18,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: AppTheme.colors.primaryLight,
                borderWidth: 1,
                borderColor: AppTheme.colors.primaryBorder,
              }}
            >
              <Text style={{ color: AppTheme.colors.primary, fontWeight: '700', fontSize: 13 }}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Inside the paper window rather than beside it: iOS presents one
            modal at a time, so a picker opened as a sibling of an open modal
            never appeared there. */}
        <ColorPickerModal
          visible={paperPickerVisible}
          value={customNotePageColor}
          title="Custom page colour"
          hint="The paper your notes are written on."
          onSelect={setCustomNotePageColor}
          onClose={() => setPaperPickerVisible(false)}
        />
      </Modal>

      {/* NOTE PIN PROMPT */}
      <Modal visible={!!pinModalNote} transparent animationType="fade" onRequestClose={() => setPinModalNote(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 18 }}
        >
          <View style={{ backgroundColor: '#ffffff', borderRadius: 18, maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 12, flex: 1 }}>
                  {pinAction === 'edit'
                    ? `Verify PIN to Edit ${pinModalNote?.title}`
                    : pinAction === 'delete'
                      ? `Verify PIN to Delete ${pinModalNote?.title}`
                      : `Unlock ${pinModalNote?.title}`}
                </Text>
                <ModalCloseButton onPress={closePinModal} />
              </View>
              <TextInput
                style={{
                  backgroundColor: '#f8fafc',
                  borderWidth: 1,
                  borderColor: pinError ? AppTheme.colors.error : '#e2e8f0',
                  borderRadius: 10,
                  padding: 13,
                  fontSize: 14,
                  color: AppTheme.colors.text,
                  letterSpacing: pinInput ? 6 : 0,
                  marginBottom: pinError ? 8 : 16,
                }}
                placeholder="4-Digit PIN"
                placeholderTextColor={AppTheme.colors.textSecondary}
                value={pinInput}
                onChangeText={t => {
                  setPinInput(t.replace(/[^0-9]/g, '').slice(0, 4));
                  setPinError('');
                }}
                keyboardType="numeric"
                secureTextEntry
                maxLength={4}
                autoFocus
              />
              {!!pinError && (
                <Text style={{ color: AppTheme.colors.error, fontSize: 12, fontWeight: '600', marginBottom: 14 }}>
                  {pinError}
                </Text>
              )}
              {noteBiometricOn && pinModalNote && (
                <BiometricUnlockButton onPress={() => tryNoteBiometric(pinModalNote, pinAction)} style={{ marginBottom: 12 }} />
              )}
              <View style={{ flexDirection: 'row' }}>
                <TouchableOpacity
                  onPress={() => {
                    setPinModalNote(null);
                    setPinInput('');
                    setPinError('');
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 13,
                    borderRadius: 10,
                    backgroundColor: AppTheme.colors.border,
                    alignItems: 'center',
                    marginRight: 8,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: AppTheme.colors.primary }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handlePinSubmit}
                  disabled={pinInput.length !== 4}
                  style={{
                    flex: 1,
                    paddingVertical: 13,
                    borderRadius: 10,
                    backgroundColor: pinInput.length === 4 ? AppTheme.colors.primary : AppTheme.colors.border,
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '700',
                      color: pinInput.length === 4 ? '#ffffff' : AppTheme.colors.textSecondary,
                    }}
                  >
                    Unlock
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
