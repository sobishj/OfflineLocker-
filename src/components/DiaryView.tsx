import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Animated,
  PanResponder,
  useWindowDimensions,
  Platform,
  Keyboard,
  Modal,
  Alert,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLockerStore } from '../store/useLockerStore';
import { AppTheme } from '../theme/AppTheme';
import { DiaryPinMode } from '../models';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `YYYY-MM-DD` in local time — `toISOString` would shift the day across timezones. */
export const toDateKey = (date: Date): string => {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const fromDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (key: string, delta: number): string => {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + delta);
  return toDateKey(date);
};

const daysInMonth = (year: number, monthIndex: number) => new Date(year, monthIndex + 1, 0).getDate();

/** Ruled-line spacing, shared by the written text and the lines behind it. */
const PAGE_LINE_HEIGHT = 24;
const PAGE_PADDING = 16;

/** Rings in the spiral binding down the left edge. */
const SPIRAL_COUNT = 16;

/** How far a drag must travel before it counts as a page turn. */
const SWIPE_THRESHOLD = 60;

interface DiaryViewProps {
  isMobile: boolean;
}

export default function DiaryView({ isMobile }: DiaryViewProps) {
  const {
    diaryDates, loadDiaryDates, getDiaryEntry, saveDiaryEntry,
    diaryPinMode, loadDiaryPinMode, setDiaryPin, verifyDiaryPin,
    diaryLined, loadDiaryLined, setDiaryLined,
  } = useLockerStore();
  const { width: screenWidth } = useWindowDimensions();

  const today = useMemo(() => toDateKey(new Date()), []);
  const [currentDate, setCurrentDate] = useState(today);
  const [pageText, setPageText] = useState('');
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  // Both pickers are closed by default; the page fills the tab like a real diary
  // The month navigator slides down from the top. Pinning keeps it there;
  // unpinned it collapses again so the page gets the whole tab.
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelPinned, setPanelPinned] = useState(false);
  const panelAnim = useRef(new Animated.Value(0)).current;
  // Tapping the month or the year in the popup header swaps which list is shown
  const [panelMode, setPanelMode] = useState<'days' | 'months' | 'years'>('days');
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());

  // Diary-wide lock. The tab stays covered until the PIN is entered once per session.
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [manageVisible, setManageVisible] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [manageError, setManageError] = useState('');
  // Which option the radios show. It is a draft: 'app' applies at once because
  // it needs no PIN, while 'custom' waits for the PIN to be entered.
  const [pinChoice, setPinChoice] = useState<DiaryPinMode>('none');

  const year = fromDateKey(currentDate).getFullYear();
  const writtenDates = useMemo(() => new Set(diaryDates), [diaryDates]);

  // The page currently on screen, and the one rotating in behind it
  // 0 = lying flat, 1 = swung fully over on its spine
  const turn = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const [isFlipping, setIsFlipping] = useState(false);
  // The page underneath, revealed as the top sheet swings across
  const [underText, setUnderText] = useState<string | null>(null);
  // Measured so exactly the right number of rules is drawn, which avoids
  // needing overflow clipping on a sheet that is being rotated in 3D
  const [pageHeight, setPageHeight] = useState(0);

  // Kept in refs so the PanResponder, created once, always sees current values
  const pageTextRef = useRef(pageText);
  const currentDateRef = useRef(currentDate);
  useEffect(() => { pageTextRef.current = pageText; }, [pageText]);
  useEffect(() => { currentDateRef.current = currentDate; }, [currentDate]);

  useEffect(() => {
    loadDiaryDates();
    loadDiaryPinMode();
    loadDiaryLined();
  }, []);

  useEffect(() => {
    if (diaryPinMode === 'none') setIsUnlocked(true);
  }, [diaryPinMode]);

  /** Persists the page being left before loading another. */
  const persistCurrent = useCallback(async () => {
    await saveDiaryEntry(currentDateRef.current, pageTextRef.current);
  }, [saveDiaryEntry]);

  // Blur and page turns are not the only ways to leave a page: switching tabs
  // unmounts this view without either firing, which lost whatever was typed.
  // A short debounce after each keystroke means the text is already on disk.
  useEffect(() => {
    if (!isUnlocked || isFlipping) return;
    const timer = setTimeout(() => { persistCurrent(); }, 600);
    return () => clearTimeout(timer);
  }, [pageText, isUnlocked, isFlipping, persistCurrent]);

  // A final write on the way out, for anything typed inside the debounce window
  const persistRef = useRef(persistCurrent);
  useEffect(() => { persistRef.current = persistCurrent; });
  useEffect(() => () => { persistRef.current(); }, []);

  const openDate = useCallback(async (dateKey: string) => {
    setIsLoadingPage(true);
    try {
      const text = await getDiaryEntry(dateKey);
      setPageText(text);
      setCurrentDate(dateKey);
    } finally {
      setIsLoadingPage(false);
    }
  }, [getDiaryEntry]);

  // Load today's page on mount
  useEffect(() => {
    openDate(today);
  }, []);

  /**
   * Turns to an adjacent day. The outgoing page rotates away around its spine
   * before the new day's text is swapped in, which reads as a page being lifted.
   */
  /**
   * Turns a single sheet on its spine, the way a paper diary does: the sheet
   * swings across about its bound (left) edge while the page it uncovers sits
   * flat underneath. `backfaceVisibility` hides the sheet once it passes
   * upright, so its text is never seen mirrored.
   *
   * Forwards, the sheet being left behind is the one that moves. Backwards,
   * the sheet swinging back down is the one arriving.
   */
  const turnPage = useCallback(async (delta: number) => {
    if (isFlipping) return;
    Keyboard.dismiss();
    setIsFlipping(true);
    drag.setValue(0);
    await persistCurrent();

    const target = addDays(currentDateRef.current, delta);
    const targetText = await getDiaryEntry(target);

    if (delta > 0) {
      setUnderText(targetText);
      turn.setValue(0);
      Animated.timing(turn, {
        toValue: 1,
        duration: 460,
        useNativeDriver: true,
      }).start(() => {
        setPageText(targetText);
        setCurrentDate(target);
        setUnderText(null);
        turn.setValue(0);
        setIsFlipping(false);
      });
    } else {
      setUnderText(pageTextRef.current);
      setPageText(targetText);
      setCurrentDate(target);
      turn.setValue(1);
      Animated.timing(turn, {
        toValue: 0,
        duration: 460,
        useNativeDriver: true,
      }).start(() => {
        setUnderText(null);
        setIsFlipping(false);
      });
    }
  }, [drag, getDiaryEntry, isFlipping, persistCurrent, turn]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim clearly horizontal drags, so the text area keeps its own
        // vertical scrolling and taps
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_evt, gesture) => {
          // Only a small lift follows the finger; the sheet turns on release
          const progress = Math.max(-1, Math.min(1, gesture.dx / (screenWidth * 0.8)));
          drag.setValue(progress);
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dx <= -SWIPE_THRESHOLD) {
            turnPage(1);
          } else if (gesture.dx >= SWIPE_THRESHOLD) {
            turnPage(-1);
          } else {
            Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          }
        },
      }),
    [drag, screenWidth, turnPage]
  );

  const pageStyle = {
    // Anchored on the bound edge, so the sheet pivots rather than slides
    transformOrigin: 'left center',
    backfaceVisibility: 'hidden' as const,
    transform: [
      { perspective: 1400 },
      {
        rotateY: turn.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '-180deg'],
        }),
      },
      // A slight give under the finger before the sheet commits to turning
      {
        translateX: drag.interpolate({
          inputRange: [-1, 0, 1],
          outputRange: [-26, 0, 26],
        }),
      },
    ],
    // The lifted sheet catches a little more shadow mid-swing
    shadowOpacity: turn.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.06, 0.28, 0.06],
    }),
  };

  const ruleCount = Math.max(0, Math.floor((pageHeight - PAGE_PADDING * 2) / PAGE_LINE_HEIGHT));

  const renderRules = () =>
    diaryLined && ruleCount > 0 ? (
      <View style={styles.ruleLayer} pointerEvents="none">
        {Array.from({ length: ruleCount }, (_, i) => (
          <View key={i} style={styles.rule} />
        ))}
      </View>
    ) : null;

  const dateObj = fromDateKey(currentDate);
  const headingDay = `${WEEKDAY_NAMES[dateObj.getDay()]}`;
  const headingDate = `${dateObj.getDate()} ${MONTH_NAMES[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
  const isToday = currentDate === today;

  const openManage = () => {
    setNewPin('');
    setConfirmPin('');
    setManageError('');
    setPinChoice(diaryPinMode);
    setManageVisible(true);
  };

  const handleUnlock = () => {
    if (!verifyDiaryPin(pinInput)) {
      setPinError('Incorrect PIN. Please try again.');
      setPinInput('');
      return;
    }
    setPinError('');
    setPinInput('');
    setIsUnlocked(true);
  };

  const applyPinMode = async (mode: DiaryPinMode) => {
    if (mode === 'custom') {
      if (newPin.length !== 4) {
        setManageError('Enter a 4-digit PIN.');
        return;
      }
      if (newPin !== confirmPin) {
        setManageError('The PIN and its confirmation do not match.');
        return;
      }
    }
    await setDiaryPin(mode, mode === 'custom' ? newPin : undefined);
    setPinChoice(mode);
    setManageVisible(false);
    setNewPin('');
    setConfirmPin('');
    setManageError('');
    // Setting or changing a PIN leaves the diary open for the current session
    setIsUnlocked(true);
  };

  const confirmRemovePin = () => {
    Alert.alert('Remove Diary PIN', 'The diary will open without a PIN. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => applyPinMode('none') },
    ]);
  };

  /** Jumps to a day and closes whichever picker was used to get there. */
  const pickDate = async (dateKey: string) => {
    setPanelMode('days');
    collapsePanelIfUnpinned();
    if (dateKey === currentDate) return;
    await persistCurrent();
    openDate(dateKey);
  };

  /** Month grid for `calendarMonth`/`calendarYear`, Monday-first. */
  /** Years offered in the year list: a wide span either side of today. */
  const YEAR_SPAN = 60;
  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear();
    return Array.from({ length: YEAR_SPAN + 21 }, (_, i) => base - YEAR_SPAN + i);
  }, []);

  const yearScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    Animated.timing(panelAnim, {
      toValue: panelOpen ? 1 : 0,
      duration: 220,
      // Height cannot be driven natively, so this one runs on the JS thread
      useNativeDriver: false,
    }).start();
  }, [panelOpen, panelAnim]);

  /** Closing only happens when the panel is not pinned. */
  const collapsePanelIfUnpinned = () => {
    if (!panelPinned) setPanelOpen(false);
  };

  // Open the year list near the year being viewed rather than at its start
  useEffect(() => {
    if (panelMode !== 'years') return;
    const index = yearOptions.indexOf(calendarYear);
    if (index < 0) return;
    const YEARS_PER_ROW = 4;
    const ROW_HEIGHT = 54;
    const offset = Math.max(0, Math.floor(index / YEARS_PER_ROW) * ROW_HEIGHT - 90);
    // A frame's delay lets the ScrollView measure before it is told where to go
    const timer = setTimeout(() => yearScrollRef.current?.scrollTo({ y: offset, animated: false }), 30);
    return () => clearTimeout(timer);
  }, [panelMode, calendarYear, yearOptions]);

  const stepMonth = (delta: number) => {
    const next = new Date(calendarYear, calendarMonth + delta, 1);
    setCalendarMonth(next.getMonth());
    setCalendarYear(next.getFullYear());
  };

  const renderDayGrid = () => {
    const firstOfMonth = new Date(calendarYear, calendarMonth, 1);
    // getDay() is Sunday-based; shift so Monday starts the row
    const leading = (firstOfMonth.getDay() + 6) % 7;
    const total = daysInMonth(calendarYear, calendarMonth);
    const cells: (number | null)[] = [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: total }, (_, i) => i + 1),
    ];

    return (
      <>
        <View style={{ flexDirection: 'row', paddingHorizontal: 6, paddingBottom: 4 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <Text key={`${d}${i}`} style={styles.weekdayCell}>{d}</Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6 }}>
          {cells.map((day, i) => {
            if (day === null) return <View key={`pad${i}`} style={styles.dayCell} />;
            const key = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const selected = key === currentDate;
            const written = writtenDates.has(key);
            const isTodayCell = key === today;
            return (
              <TouchableOpacity key={key} onPress={() => pickDate(key)} style={styles.dayCell} activeOpacity={0.7}>
                <View
                  style={[
                    styles.dayInner,
                    written && styles.dayWritten,
                    isTodayCell && !selected && styles.dayToday,
                    selected && styles.daySelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      written && !selected && styles.dayTextWritten,
                      selected && styles.dayTextSelected,
                    ]}
                  >
                    {day}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: AppTheme.colors.primaryLight, borderColor: AppTheme.colors.primaryBorder }]} />
          <Text style={styles.legendText}>Has an entry</Text>
        </View>
      </>
    );
  };

  const renderMonthList = () => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6 }}>
      {MONTH_NAMES.map((name, idx) => {
        const hasEntries = diaryDates.some(d => {
          const parts = d.split('-');
          return Number(parts[0]) === calendarYear && Number(parts[1]) === idx + 1;
        });
        const isCurrent = idx === calendarMonth;
        return (
          <TouchableOpacity
            key={name}
            onPress={() => { setCalendarMonth(idx); setPanelMode('days'); }}
            style={styles.monthCell}
            activeOpacity={0.7}
          >
            <View style={[styles.monthInner, isCurrent && styles.monthInnerActive]}>
              <Text style={[styles.monthText, isCurrent && styles.monthTextActive]}>{name.slice(0, 3)}</Text>
              {hasEntries && <View style={styles.monthDot} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderYearList = () => (
    <ScrollView
      ref={yearScrollRef}
      style={{ maxHeight: 260 }}
      contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6 }}
      showsVerticalScrollIndicator={false}
    >
      {yearOptions.map(y => {
        const hasEntries = diaryDates.some(d => Number(d.split('-')[0]) === y);
        const isCurrent = y === calendarYear;
        return (
          <TouchableOpacity
            key={y}
            onPress={() => { setCalendarYear(y); setPanelMode('months'); }}
            style={styles.monthCell}
            activeOpacity={0.7}
          >
            <View style={[styles.monthInner, isCurrent && styles.monthInnerActive]}>
              <Text style={[styles.monthText, isCurrent && styles.monthTextActive]}>{y}</Text>
              {hasEntries && <View style={styles.monthDot} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  /** The date navigator: month and year act as dropdowns, the calendar chip
   *  returns to the days of whatever month and year are selected. */
  const renderSlidePanel = () => (
    <Animated.View
      style={{
        height: panelAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 412] }),
        opacity: panelAnim,
        overflow: 'hidden',
      }}
    >
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <TouchableOpacity
            onPress={() => setPanelMode(panelMode === 'months' ? 'days' : 'months')}
            style={[styles.headerChip, panelMode === 'months' && styles.headerChipActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.headerChipText, panelMode === 'months' && styles.headerChipTextActive]}>
              {MONTH_NAMES[calendarMonth]}
            </Text>
            <Ionicons
              name="chevron-down"
              size={12}
              color={panelMode === 'months' ? '#ffffff' : AppTheme.colors.primary}
              style={{ marginLeft: 3 }}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setPanelMode(panelMode === 'years' ? 'days' : 'years')}
            style={[styles.headerChip, panelMode === 'years' && styles.headerChipActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.headerChipText, panelMode === 'years' && styles.headerChipTextActive]}>
              {calendarYear}
            </Text>
            <Ionicons
              name="chevron-down"
              size={12}
              color={panelMode === 'years' ? '#ffffff' : AppTheme.colors.primary}
              style={{ marginLeft: 3 }}
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            onPress={() => setPanelPinned(!panelPinned)}
            style={[styles.pinBtn, panelPinned && styles.pinBtnActive]}
            accessibilityLabel={panelPinned ? 'Unpin panel' : 'Pin panel open'}
          >
            <Ionicons
              name={panelPinned ? 'pin' : 'pin-outline'}
              size={15}
              color={panelPinned ? '#ffffff' : AppTheme.colors.primary}
            />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }}>
          {panelMode === 'days' && (
            <>
              {/* Stepping a month at a time, without leaving the day grid */}
              <View style={styles.monthStepRow}>
                <TouchableOpacity onPress={() => stepMonth(-1)} style={{ padding: 5 }}>
                  <Ionicons name="chevron-back" size={16} color={AppTheme.colors.primary} />
                </TouchableOpacity>
                <Text style={styles.monthStepText}>
                  {MONTH_NAMES[calendarMonth]} {calendarYear}
                </Text>
                <TouchableOpacity onPress={() => stepMonth(1)} style={{ padding: 5 }}>
                  <Ionicons name="chevron-forward" size={16} color={AppTheme.colors.primary} />
                </TouchableOpacity>
              </View>
              {renderDayGrid()}
            </>
          )}
          {panelMode === 'months' && renderMonthList()}
          {panelMode === 'years' && renderYearList()}
        </View>

        <View style={styles.panelFooter}>
          <Text style={styles.panelCount}>
            {diaryDates.length} {diaryDates.length === 1 ? 'page written' : 'pages written'}
          </Text>
          <TouchableOpacity onPress={() => pickDate(today)} style={styles.todayBtn} activeOpacity={0.7}>
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );

  const renderPage = () => (
    <View style={{ flex: 1 }}>
      {/* HEADER — the date, with the pickers and the lock on the right */}
      <View style={styles.header}>
        {/* The date and its two arrows are laid over the whole row so the
            buttons on the right cannot pull them off centre */}
        <View style={styles.dateGroup} pointerEvents="box-none">
          {/* Mirrors the badge slot on the right so the date stays dead centre
              whether or not the badge is showing */}
          <View style={styles.todaySlot} />

          <TouchableOpacity onPress={() => turnPage(-1)} style={styles.arrowBtn} accessibilityLabel="Previous day">
            <Ionicons name="chevron-back" size={20} color={AppTheme.colors.primary} />
          </TouchableOpacity>

          <View style={styles.dateBlock}>
            <Text style={styles.headerWeekday}>{headingDay}</Text>
            <Text style={styles.headerDate} numberOfLines={1}>{headingDate}</Text>
          </View>

          <TouchableOpacity onPress={() => turnPage(1)} style={styles.arrowBtn} accessibilityLabel="Next day">
            <Ionicons name="chevron-forward" size={20} color={AppTheme.colors.primary} />
          </TouchableOpacity>

          <View style={styles.todaySlot}>
            {isToday && (
              <View style={styles.todayBadge}>
                <Text style={styles.todayBadgeText}>TODAY</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          onPress={() => {
            if (!panelOpen) {
              // Open on the month being read, not wherever it was left last time
              const d = fromDateKey(currentDate);
              setCalendarMonth(d.getMonth());
              setCalendarYear(d.getFullYear());
              setPanelMode('days');
            }
            setPanelOpen(!panelOpen);
          }}
          style={[styles.headerBtn, panelOpen && styles.headerBtnActive]}
          accessibilityLabel={panelOpen ? 'Hide month panel' : 'Show month panel'}
        >
          <Ionicons
            name={panelOpen ? 'calendar' : 'calendar-outline'}
            size={18}
            color={panelOpen ? '#ffffff' : AppTheme.colors.primary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setDiaryLined(!diaryLined)}
          style={[styles.headerBtn, diaryLined && styles.headerBtnActive]}
          accessibilityLabel={diaryLined ? 'Switch to plain pages' : 'Switch to lined pages'}
        >
          <Ionicons
            name="reorder-four-outline"
            size={18}
            color={diaryLined ? '#ffffff' : AppTheme.colors.primary}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={openManage} style={{ padding: 6 }} accessibilityLabel="Diary PIN settings">
          <Ionicons
            name={diaryPinMode === 'none' ? 'lock-open-outline' : 'lock-closed'}
            size={17}
            color={diaryPinMode === 'none' ? '#94a3b8' : '#f59e0b'}
          />
        </TouchableOpacity>
      </View>

      {renderSlidePanel()}

      {/* THE PAGE */}
      <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 10 }} {...panResponder.panHandlers}>
        <View style={{ flex: 1 }}>
          {/* The binding stays put while the sheets turn through it */}
          <View style={styles.spiralColumn} pointerEvents="none">
            {Array.from({ length: SPIRAL_COUNT }, (_, i) => (
              <View key={i} style={styles.spiralRing} />
            ))}
          </View>
          {/* The sheet being uncovered, lying flat under the one that moves */}
          {underText !== null && (
            <View style={[styles.page, styles.pageFill]} pointerEvents="none">
              {renderRules()}
              <Text style={styles.pageInput}>{underText}</Text>
            </View>
          )}

          <Animated.View
            style={[styles.page, styles.pageFill, pageStyle]}
            onLayout={e => setPageHeight(e.nativeEvent.layout.height)}
          >
            {renderRules()}
            <TextInput
              style={[styles.pageInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
              placeholder={isLoadingPage ? '' : 'Write about your day\u2026'}
              placeholderTextColor="#b6b0a0"
              value={pageText}
              onChangeText={setPageText}
              onBlur={persistCurrent}
              multiline
              editable={!isFlipping}
              scrollEnabled
            />
          </Animated.View>
        </View>

        <Text style={styles.hint}>Swipe left or right to turn the page</Text>
      </View>
    </View>
  );


  const renderManageModal = () => (
    <Modal visible={manageVisible} transparent animationType="fade" onRequestClose={() => setManageVisible(false)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', padding: 18 }}
      >
        <View style={{ backgroundColor: '#ffffff', borderRadius: 18, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text, marginBottom: 4 }}>
            Diary PIN
          </Text>
          <Text style={{ fontSize: 12, color: AppTheme.colors.textSecondary, marginBottom: 14 }}>
            {diaryPinMode === 'none'
              ? 'The diary currently opens without a PIN.'
              : diaryPinMode === 'app'
                ? 'The diary currently uses your app unlock PIN.'
                : 'The diary currently uses its own PIN.'}
          </Text>

          {/* Reuse the account PIN rather than keeping a second one */}
          <TouchableOpacity
            onPress={() => { setPinChoice('app'); applyPinMode('app'); }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 13,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: '#e2e8f0',
              backgroundColor: '#ffffff',
              marginBottom: 10,
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name={pinChoice === 'app' ? 'radio-button-on' : 'radio-button-off'}
              size={19}
              color={pinChoice === 'app' ? AppTheme.colors.primary : '#94a3b8'}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '700', color: AppTheme.colors.text }}>
                Use my app PIN
              </Text>
              <Text style={{ fontSize: 11.5, color: AppTheme.colors.textSecondary, marginTop: 2 }}>
                The same 4-digit PIN you unlock OfflineLocker with.
              </Text>
            </View>
          </TouchableOpacity>

          {/* A PIN that belongs to the diary alone */}
          <View
            style={{
              padding: 13,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: '#e2e8f0',
              backgroundColor: '#ffffff',
              marginBottom: 10,
            }}
          >
            <TouchableOpacity
              onPress={() => { setPinChoice('custom'); setManageError(''); }}
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={pinChoice === 'custom' ? 'radio-button-on' : 'radio-button-off'}
                size={19}
                color={pinChoice === 'custom' ? AppTheme.colors.primary : '#94a3b8'}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: AppTheme.colors.text }}>
                  {diaryPinMode === 'custom' ? 'Change the diary PIN' : 'Use a separate diary PIN'}
                </Text>
              </View>
            </TouchableOpacity>

            <TextInput
              style={{
                backgroundColor: '#f8fafc',
                borderWidth: 1,
                borderColor: '#e2e8f0',
                borderRadius: 10,
                padding: 11,
                fontSize: 14,
                color: AppTheme.colors.text,
                marginBottom: 8,
                letterSpacing: newPin ? 6 : 0,
              }}
              placeholder="4-Digit Diary PIN"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={newPin}
              onChangeText={t => { setNewPin(t.replace(/[^0-9]/g, '').slice(0, 4)); setManageError(''); }}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
            />
            <TextInput
              style={{
                backgroundColor: '#f8fafc',
                borderWidth: 1,
                borderColor: '#e2e8f0',
                borderRadius: 10,
                padding: 11,
                fontSize: 14,
                color: AppTheme.colors.text,
                marginBottom: 10,
                letterSpacing: confirmPin ? 6 : 0,
              }}
              placeholder="Confirm Diary PIN"
              placeholderTextColor={AppTheme.colors.textSecondary}
              value={confirmPin}
              onChangeText={t => { setConfirmPin(t.replace(/[^0-9]/g, '').slice(0, 4)); setManageError(''); }}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
            />
            <TouchableOpacity
              onPress={() => applyPinMode('custom')}
              disabled={newPin.length !== 4 || confirmPin.length !== 4}
              style={{
                paddingVertical: 11,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor:
                  newPin.length === 4 && confirmPin.length === 4 ? AppTheme.colors.primary : AppTheme.colors.border,
              }}
            >
              <Text
                style={{
                  fontSize: 13.5,
                  fontWeight: '700',
                  color: newPin.length === 4 && confirmPin.length === 4 ? '#ffffff' : AppTheme.colors.textSecondary,
                }}
              >
                {diaryPinMode === 'custom' ? 'Change PIN' : 'Enable PIN'}
              </Text>
            </TouchableOpacity>
          </View>

          {!!manageError && (
            <Text style={{ color: AppTheme.colors.error, fontSize: 12, fontWeight: '600', marginBottom: 10 }}>
              {manageError}
            </Text>
          )}

          {diaryPinMode !== 'none' && (
            <TouchableOpacity
              onPress={confirmRemovePin}
              style={{
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#fecaca',
                backgroundColor: '#fef2f2',
                marginBottom: 10,
              }}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#b91c1c' }}>Remove PIN security</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => setManageVisible(false)}
            style={{
              paddingVertical: 12,
              borderRadius: 10,
              alignItems: 'center',
              backgroundColor: AppTheme.colors.border,
            }}
          >
            <Text style={{ fontSize: 13.5, fontWeight: '700', color: AppTheme.colors.primary }}>Close</Text>
          </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  // The whole tab stays covered until the PIN is entered
  if (!isUnlocked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 }}>
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 20,
            backgroundColor: '#fffbeb',
            borderWidth: 1,
            borderColor: '#fde68a',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
          }}
        >
          <Ionicons name="lock-closed" size={26} color="#f59e0b" />
        </View>
        <Text style={{ fontSize: 17, fontWeight: '800', color: AppTheme.colors.text }}>Diary is locked</Text>
        <Text
          style={{
            fontSize: 12.5,
            color: AppTheme.colors.textSecondary,
            marginTop: 5,
            marginBottom: 18,
            textAlign: 'center',
          }}
        >
          {diaryPinMode === 'app'
            ? 'Enter your app PIN to open the diary.'
            : 'Enter your diary PIN to open it.'}
        </Text>

        <TextInput
          style={{
            width: '100%',
            maxWidth: 280,
            backgroundColor: '#f8fafc',
            borderWidth: 1,
            borderColor: pinError ? AppTheme.colors.error : '#e2e8f0',
            borderRadius: 10,
            padding: 13,
            fontSize: 15,
            textAlign: 'center',
            color: AppTheme.colors.text,
            letterSpacing: pinInput ? 8 : 0,
          }}
          placeholder="4-Digit PIN"
          placeholderTextColor={AppTheme.colors.textSecondary}
          value={pinInput}
          onChangeText={t => { setPinInput(t.replace(/[^0-9]/g, '').slice(0, 4)); setPinError(''); }}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
        />
        {!!pinError && (
          <Text style={{ color: AppTheme.colors.error, fontSize: 12, fontWeight: '600', marginTop: 8 }}>
            {pinError}
          </Text>
        )}

        <TouchableOpacity
          onPress={handleUnlock}
          disabled={pinInput.length !== 4}
          style={{
            width: '100%',
            maxWidth: 280,
            marginTop: 14,
            paddingVertical: 13,
            borderRadius: 10,
            alignItems: 'center',
            backgroundColor: pinInput.length === 4 ? AppTheme.colors.primary : AppTheme.colors.border,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: '700',
              color: pinInput.length === 4 ? '#ffffff' : AppTheme.colors.textSecondary,
            }}
          >
            Unlock Diary
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {renderPage()}
      {renderManageModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 10,
    position: 'relative',
  },
  dateGroup: {
    position: 'absolute',
    left: 0,
    // Stop short of the buttons on the right so the TODAY badge is not drawn
    // underneath them; the date then centres in the space that is left
    right: 126,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Equal padding on both arrows keeps them the same distance from the date
  arrowBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  dateBlock: { alignItems: 'center', maxWidth: '62%' },
  headerWeekday: { fontSize: 11, color: AppTheme.colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  // Weight 700 throughout, matching the note name in the Notes tab
  headerDate: { fontSize: 16, fontWeight: '700', color: AppTheme.colors.text, textAlign: 'center' },
  todaySlot: { width: 56, alignItems: 'flex-start' },
  todayBadge: {
    marginLeft: 4,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: AppTheme.colors.primaryLight,
  },
  todayBadgeText: { fontSize: 9, fontWeight: '800', color: AppTheme.colors.primary },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.colors.primaryBorder,
    backgroundColor: AppTheme.colors.primaryLight,
    marginLeft: 6,
  },
  headerBtnActive: { backgroundColor: AppTheme.colors.primary, borderColor: AppTheme.colors.primary },

  panel: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingBottom: 6,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  panelCount: { flex: 1, fontSize: 10.5, color: AppTheme.colors.textSecondary },
  panelFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  todayBtn: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: AppTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: AppTheme.colors.primaryBorder,
  },
  todayBtnText: { fontSize: 12.5, fontWeight: '700', color: AppTheme.colors.primary },
  monthStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 4,
  },
  monthStepText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: AppTheme.colors.textSecondary,
    marginHorizontal: 6,
  },
  pinBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppTheme.colors.primaryBorder,
    backgroundColor: AppTheme.colors.primaryLight,
  },
  pinBtnActive: { backgroundColor: AppTheme.colors.primary, borderColor: AppTheme.colors.primary },

  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  calendarCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  headerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    marginHorizontal: 3,
    backgroundColor: AppTheme.colors.primaryLight,
    borderWidth: 1,
    borderColor: AppTheme.colors.primaryBorder,
  },
  headerChipActive: { backgroundColor: AppTheme.colors.primary, borderColor: AppTheme.colors.primary },
  headerChipText: { fontSize: 13.5, fontWeight: '800', color: AppTheme.colors.primary },
  headerChipTextActive: { color: '#ffffff' },
  calendarFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingTop: 8,
    marginTop: 2,
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
    backgroundColor: AppTheme.colors.primaryLight,
    marginHorizontal: 3,
  },
  footerBtnPlain: { backgroundColor: '#f1f5f9' },
  footerBtnText: { fontSize: 13, fontWeight: '700', color: AppTheme.colors.primary },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  pickerTitle: { fontSize: 14, fontWeight: '800', color: AppTheme.colors.text },
  weekdayCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: AppTheme.colors.textSecondary,
  },

  dayCell: { width: `${100 / 7}%`, height: 40, padding: 2 },
  dayInner: { flex: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dayWritten: { backgroundColor: AppTheme.colors.primaryLight, borderWidth: 1, borderColor: AppTheme.colors.primaryBorder },
  dayToday: { borderWidth: 1.5, borderColor: AppTheme.colors.primary },
  daySelected: { backgroundColor: AppTheme.colors.primary },
  dayText: { fontSize: 12.5, fontWeight: '600', color: AppTheme.colors.text },
  dayTextWritten: { fontWeight: '800', color: AppTheme.colors.primary },
  dayTextSelected: { color: '#ffffff', fontWeight: '800' },

  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 2,
  },
  legendDot: { width: 11, height: 11, borderRadius: 3, borderWidth: 1, marginRight: 6 },
  legendText: { fontSize: 10.5, color: AppTheme.colors.textSecondary },

  monthCell: { width: '25%', padding: 4 },
  monthInner: {
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  monthInnerActive: { backgroundColor: AppTheme.colors.primaryLight, borderColor: AppTheme.colors.primary },
  monthText: { fontSize: 12.5, fontWeight: '700', color: AppTheme.colors.text },
  monthTextActive: { color: AppTheme.colors.primary, fontWeight: '800' },
  monthDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: AppTheme.colors.primary,
    marginTop: 3,
  },

  pageFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  spiralColumn: {
    position: 'absolute',
    left: -3,
    top: 14,
    bottom: 14,
    width: 30,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spiralRing: {
    width: 26,
    height: 11,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: '#1a1a1a',
    backgroundColor: 'transparent',
    // A slight tilt reads as wire rather than a stack of pills
    transform: [{ rotate: '-10deg' }],
  },
  page: {
    flex: 1,
    shadowColor: '#000',
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 0 },
    elevation: 2,
    backgroundColor: '#fffdf7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e7e2d4',
    borderLeftWidth: 1,
    borderLeftColor: '#e7e2d4',
    padding: PAGE_PADDING,
    // Room down the left for the spiral binding
    paddingLeft: 40,
  },
  ruleLayer: {
    position: 'absolute',
    left: 40,
    right: PAGE_PADDING,
    top: PAGE_PADDING,
    bottom: PAGE_PADDING,
  },
  rule: { height: PAGE_LINE_HEIGHT, borderBottomWidth: 1, borderBottomColor: '#e6e0d0' },
  pageInput: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: PAGE_LINE_HEIGHT,
    color: AppTheme.colors.text,
    textAlignVertical: 'top',
    padding: 0,
  },
  hint: {
    fontSize: 10,
    color: AppTheme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
});
