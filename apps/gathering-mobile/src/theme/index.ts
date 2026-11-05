import { colors, layout, radius, space, typography } from '@member/shared';

export const theme = {
  colors: {
    ...colors,
    bg: {
      default: '#FFFFFF',
      subtle: '#F4F7FB',
    },
    text: {
      ...colors.text,
      primary: '#1B3A6B',
    },
    accent: '#1C7ED6',
  },
  space,
  radius,
  typography,
  layout,
} as const;
