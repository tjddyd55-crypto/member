export const colors = {
  bg: {
    default: '#FFFFFF',
    subtle: '#F5F7FA',
  },
  surface: {
    default: '#FFFFFF',
    elevated: '#FFFFFF',
  },
  primary: {
    default: '#1B3A6B',
    pressed: '#122A4F',
    soft: '#E8EEF7',
  },
  text: {
    primary: '#1F2933',
    secondary: '#616E7C',
    disabled: '#9AA5B1',
    onPrimary: '#FFFFFF',
  },
  border: {
    default: '#E4E7EB',
  },
  status: {
    success: '#2F9E44',
    warning: '#F59F00',
    error: '#E03131',
    info: '#1C7ED6',
  },
  overlay: {
    scrim: 'rgba(31, 41, 51, 0.45)',
  },
} as const;

export const space = {
  4: 4,
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  32: 32,
} as const;

export const radius = {
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  full: 999,
} as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 36, fontWeight: '700' as const },
  pageTitle: { fontSize: 22, lineHeight: 30, fontWeight: '700' as const },
  sectionTitle: { fontSize: 18, lineHeight: 26, fontWeight: '700' as const },
  cardTitle: { fontSize: 16, lineHeight: 24, fontWeight: '500' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
  button: { fontSize: 16, lineHeight: 24, fontWeight: '500' as const },
  badge: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
} as const;

export const layout = {
  screenWidthBase: 390,
  screenWidthMin: 360,
  screenWidthMax: 430,
  horizontalGutter: 20,
  buttonMinHeight: 48,
  inputMinHeight: 52,
  touchMin: 44,
} as const;

export type MembershipRole = 'MEMBER' | 'LOCAL_ADMIN' | 'LOCAL_OWNER';
export type MembershipStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'WITHDRAWN';

export function isAdminRole(role: MembershipRole): boolean {
  return role === 'LOCAL_ADMIN' || role === 'LOCAL_OWNER';
}
