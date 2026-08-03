import { colors, layout, radius, space, typography } from '@member/shared';

export const theme = {
  colors,
  space,
  radius,
  typography,
  layout,
  fontFamily: 'System',
} as const;

export type AppTheme = typeof theme;
