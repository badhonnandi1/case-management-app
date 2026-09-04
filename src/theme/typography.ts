import type { TextStyle } from 'react-native';

type Typography = Record<
  'display' | 'heading' | 'subheading' | 'body' | 'bodyStrong' | 'caption' | 'label',
  TextStyle
>;

export const typography: Typography = {
  display: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  heading: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
  },
  subheading: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.35,
  },
};
