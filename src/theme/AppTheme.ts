export const AppTheme = {
  colors: {
    background: '#f4f7fc',
    surface: '#ffffff',
    surfaceSubtle: '#f8fafc',
    primary: '#0078D4', // Vibrant cloud blue matching OneDrive image
    primaryHover: '#0067b8',
    primaryLight: '#eef6fc', // Soft cloud blue tint for badges and buttons
    primaryBorder: '#cce4f7',
    text: '#0f172a', // Deep slate bold text
    textSecondary: '#64748b', // Muted text
    textMuted: '#94a3b8',
    error: '#ef4444', // Red for delete action
    errorLight: '#fee2e2', // Light red background for delete button
    border: '#e2e8f0',
    sensitive: '#f59e0b',
    cardBackground: '#ffffff',
    cardBorder: '#f1f5f9',
    iconFolderBg: '#e1effa',
  },
  spacing: {
    xs: 4,
    s: 8,
    m: 16,
    l: 24,
    xl: 32,
  },
  borderRadius: {
    xs: 6,
    s: 10,
    m: 14,
    l: 20,
    xl: 24,
    pill: 9999,
  },
  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.03,
      shadowRadius: 12,
      elevation: 2,
    },
    fab: {
      shadowColor: '#0078D4',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 6,
    },
    modal: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 8,
    }
  }
};

