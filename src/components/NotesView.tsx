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
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLockerStore } from '../store/useLockerStore';
import { Note } from '../models';
import { AppTheme, getPageColor, PAGE_COLORS, CUSTOM_KEY } from '../theme/AppTheme';
import ColorPickerModal from './ColorPickerModal';
import DraggableFAB from './DraggableFAB';

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
  const { notes, loadNotes, addNote, updateNote, deleteNote, decryptNote, verifyNotePin, notePageColor, customNotePageColor, loadPageColors, setNotePageColor, setCustomNotePageColor } = useLockerStore();
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

  // Step 2 — writing the note itself
  const [paperVisible, setPaperVisible] = useState(false);
  const [paperPickerVisible, setPaperPickerVisible] = useState(false);
  const [writerNote, setWriterNote] = useState<Note | null>(null);
  const [writerBody, setWriterBody] = useState('');
  // Read by the close handler, which must not depend on a stale render
  const writerBodyRef = useRef(writerBody);
  useEffect(() => { writerBodyRef.current = writerBody; }, [writerBody]);

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
    setDetailsVisible(true);
  };

  /**
   * Leaving a note saves it and re-locks it. There is no Save button; the
   * diary writes the same way, so the two behave alike.
   */
  const closeWriter = async () => {
    const note = writerNote;
    const body = writerBodyRef.current;
    setWriterNote(null);
    setWriterBody('');
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
    setWriterNote(note);
    setWriterBody(decryptNote(note));
  };

  /** Runs `action` straight away for an open note, or asks for the PIN first. */
  const requirePin = (note: Note, action: PinAction, run: () => void) => {
    if (isUnlocked(note)) {
      run();
      return;
    }
    setPinModalNote(note);
    setPinAction(action);
    setPinInput('');
    setPinError('');
  };

  const handlePinSubmit = () => {
    if (!pinModalNote) return;
    if (!verifyNotePin(pinModalNote, pinInput)) {
      setPinError('Incorrect PIN. Please try again.');
      setPinInput('');
      return;
    }
    const note = pinModalNote;
    if (note.id != null) setUnlockedId(note.id);
    setPinModalNote(null);
    setPinInput('');
    setPinError('');

    if (pinAction === 'edit') openDetails(note);
    else if (pinAction === 'delete') confirmDelete(note);
    else openWriter(note);
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
        await updateNote(detailsNote.id, title, decryptNote(detailsNote), draftSensitive, draftPin || undefined);
      } else {
        await addNote(title, '', draftSensitive, draftPin || undefined);
        // The PIN was just chosen, so writing the new note straight away does
        // not ask for it again — closing that writer re-locks as usual
        if (draftSensitive) {
          const created = useLockerStore
            .getState()
            .notes.find(n => n.title === title && n.isSensitive === 1);
          if (created?.id != null) keepUnlocked = created.id;
        }
      }
      setDetailsVisible(false);
      setDetailsNote(null);
      setDraftTitle('');
      setDraftSensitive(false);
      setDraftPin('');
      setDraftConfirmPin('');
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
              <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 4 }}>
                {detailsNote ? 'Edit Note' : 'New Note'}
              </Text>
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
            onChangeText={setWriterBody}
            onBlur={persistWriter}
            multiline
            autoFocus
          />
        </View>
      </Modal>

      {/* PAGE COLOUR */}
      <Modal visible={paperVisible} transparent animationType="fade" onRequestClose={() => setPaperVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 18 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 18, padding: 18 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 4 }}>
              Page colour
            </Text>
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
                    style={{ width: '25%', alignItems: 'center', marginBottom: 14 }}
                    accessibilityLabel={option.label}
                  >
                    <View
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: option.paper,
                        borderWidth: isChosen ? 2 : 1,
                        borderColor: isChosen ? AppTheme.colors.primary : option.rule,
                      }}
                    >
                      {isChosen && <Ionicons name="checkmark" size={16} color={AppTheme.colors.primary} />}
                    </View>
                    <Text style={{ fontSize: 10.5, color: AppTheme.colors.textSecondary, marginTop: 5 }} numberOfLines={1}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {/* Whatever the user mixed; tapping it again reopens the mixer */}
              <TouchableOpacity
                onPress={() => {
                  if (notePageColor !== CUSTOM_KEY) setNotePageColor(CUSTOM_KEY);
                  setPaperPickerVisible(true);
                }}
                style={{ width: '25%', alignItems: 'center', marginBottom: 14 }}
                accessibilityLabel="Custom page colour"
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 12,
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
                    size={17}
                    color={AppTheme.colors.primary}
                  />
                </View>
                <Text style={{ fontSize: 10.5, color: AppTheme.colors.textSecondary, marginTop: 5 }} numberOfLines={1}>
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
      </Modal>

      <ColorPickerModal
        visible={paperPickerVisible}
        value={customNotePageColor}
        title="Custom page colour"
        hint="The paper your notes are written on."
        onSelect={setCustomNotePageColor}
        onClose={() => setPaperPickerVisible(false)}
      />

      {/* NOTE PIN PROMPT */}
      <Modal visible={!!pinModalNote} transparent animationType="fade" onRequestClose={() => setPinModalNote(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 18 }}
        >
          <View style={{ backgroundColor: '#ffffff', borderRadius: 18, maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 12 }}>
                {pinAction === 'edit'
                  ? `Verify PIN to Edit ${pinModalNote?.title}`
                  : pinAction === 'delete'
                    ? `Verify PIN to Delete ${pinModalNote?.title}`
                    : `Unlock ${pinModalNote?.title}`}
              </Text>
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
