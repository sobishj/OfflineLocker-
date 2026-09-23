import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, useWindowDimensions, Pressable, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTheme } from '../theme/AppTheme';
import { useLockerStore } from '../store/useLockerStore';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** The one way a date is written down in this app: DD-MM-YYYY. */
export const formatDate = (date: Date): string =>
  `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;

/**
 * Rewrites a stored date into DD-MM-YYYY for display. Documents saved before
 * the format settled still hold slashes, and a scan can return "05 Jan 2026",
 * so everything is put through here on the way to the screen. Anything that
 * cannot be read is passed along untouched rather than blanked.
 */
export const toDisplayDate = (value: string): string => {
  if (!value || typeof value !== 'string') return '';
  const parsed = parseDateString(value);
  return parsed ? formatDate(parsed) : value.trim();
};

/** Accepts DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD and "05 Jan 2026" style values. */
export const parseDateString = (value: string): Date | null => {
  if (!value || typeof value !== 'string') return null;
  const text = value.trim();

  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    return d.getMonth() === month - 1 && d.getDate() === day ? d : null;
  }

  const ymd = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  const textual = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{2,4})$/);
  if (textual) {
    const monthIndex = MONTH_ABBR.indexOf(textual[2].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      let year = Number(textual[3]);
      if (year < 100) year += 2000;
      return new Date(year, monthIndex, Number(textual[1]));
    }
  }

  const monthFirst = text.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/);
  if (monthFirst) {
    const monthIndex = MONTH_ABBR.indexOf(monthFirst[1].slice(0, 3).toLowerCase());
    if (monthIndex >= 0) {
      let year = Number(monthFirst[3]);
      if (year < 100) year += 2000;
      return new Date(year, monthIndex, Number(monthFirst[2]));
    }
  }

  return null;
};

interface DatePickerModalProps {
  visible: boolean;
  value?: string;
  title?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  /** Render as an in-place overlay instead of a Modal, for use inside an open Modal. */
  inline?: boolean;
}

export default function DatePickerModal({ visible, value, title = 'Select Date', onSelect, onClose, inline = false }: DatePickerModalProps) {
  const { width } = useWindowDimensions();
  const themeVersion = useLockerStore(state => state.themeVersion);
  const styles = useMemo(() => createStyles(), [themeVersion]);
  const isNarrow = width < 380;
  const selected = useMemo(() => parseDateString(value || ''), [value]);
  const [cursor, setCursor] = useState<Date>(() => selected || new Date());

  useEffect(() => {
    if (visible) setCursor(parseDateString(value || '') || new Date());
  }, [visible, value]);

  // Opened from beside a text field, so the keyboard may still be up and
  // would hide the calendar - nothing in here needs it
  useEffect(() => {
    if (visible) Keyboard.dismiss();
  }, [visible]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const today = new Date();

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const list: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) list.push(null);
    for (let d = 1; d <= daysInMonth; d++) list.push(d);
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [year, month]);

  const shiftMonth = (delta: number) => setCursor(new Date(year, month + delta, 1));
  const shiftYear = (delta: number) => setCursor(new Date(year + delta, month, 1));

  const isSameDay = (day: number, other: Date | null) =>
    !!other && other.getFullYear() === year && other.getMonth() === month && other.getDate() === day;

  const cellSize = isNarrow ? 34 : 38;

  const body = (
    <Pressable style={[styles.overlay, inline ? styles.inlineOverlay : null]} onPress={onClose}>
      <Pressable style={[styles.card, { maxWidth: isNarrow ? 320 : 350 }]} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={AppTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.navRow}>
            <TouchableOpacity onPress={() => shiftYear(-1)} style={styles.navBtn}>
              <Ionicons name="play-back" size={14} color={AppTheme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={18} color={AppTheme.colors.primary} />
            </TouchableOpacity>
            <Text style={styles.monthLabel} numberOfLines={1}>
              {MONTH_NAMES[month]} {year}
            </Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={18} color={AppTheme.colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => shiftYear(1)} style={styles.navBtn}>
              <Ionicons name="play-forward" size={14} color={AppTheme.colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((d, i) => (
              <View key={i} style={{ width: cellSize, alignItems: 'center' }}>
                <Text style={styles.weekday}>{d}</Text>
              </View>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, idx) => {
              if (day === null) return <View key={idx} style={{ width: cellSize, height: cellSize }} />;
              const isSelected = isSameDay(day, selected);
              const isToday = isSameDay(day, today);
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => {
                    onSelect(formatDate(new Date(year, month, day)));
                    onClose();
                  }}
                  style={[
                    { width: cellSize, height: cellSize },
                    styles.dayCell,
                    isToday && !isSelected ? styles.dayToday : null,
                    isSelected ? styles.daySelected : null,
                  ]}
                >
                  <Text style={[styles.dayText, isSelected ? styles.dayTextSelected : null]}>{day}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => { onSelect(''); onClose(); }}
              style={[styles.footerBtn, { backgroundColor: '#f1f5f9' }]}
            >
              <Text style={[styles.footerBtnText, { color: AppTheme.colors.text }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { onSelect(formatDate(new Date())); onClose(); }}
              style={[styles.footerBtn, { backgroundColor: AppTheme.colors.primary }]}
            >
              <Text style={[styles.footerBtnText, { color: '#ffffff' }]}>Today</Text>
            </TouchableOpacity>
          </View>
      </Pressable>
    </Pressable>
  );

  if (!visible) return null;

  // Nesting a Modal inside an already-open Modal breaks touches on iOS, so the
  // caller renders this as a plain overlay when it sits inside another modal.
  if (inline) return body;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {body}
    </Modal>
  );
}

/**
 * Built per accent rather than once at import: StyleSheet.create captures the
 * colours it is given, so a theme change has to rebuild these to take effect.
 */
const createStyles = () => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  inlineOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999999,
    elevation: 999999,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { flex: 1, fontSize: 16, fontWeight: '700', color: AppTheme.colors.text },
  closeBtn: { padding: 4 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: AppTheme.colors.primaryLight,
  },
  monthLabel: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', color: AppTheme.colors.text },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  weekday: { fontSize: 11, fontWeight: '700', color: AppTheme.colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  dayCell: { alignItems: 'center', justifyContent: 'center', borderRadius: 10, marginBottom: 2 },
  dayToday: { borderWidth: 1, borderColor: AppTheme.colors.primaryBorder },
  daySelected: { backgroundColor: AppTheme.colors.primary },
  dayText: { fontSize: 13, color: AppTheme.colors.text, fontWeight: '500' },
  dayTextSelected: { color: '#ffffff', fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  footerBtn: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: 8, marginLeft: 8 },
  footerBtnText: { fontSize: 13, fontWeight: '700' },
});
