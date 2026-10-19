export const boardColors = {
  blue: '#2563eb',
  violet: '#7c3aed',
  pink: '#be185d',
  red: '#dc2626',
  orange: '#c2410c',
  amber: '#a16207',
  green: '#15803d',
  teal: '#0f766e',
} as const
export type BoardColor = keyof typeof boardColors
