// Global emphasis policy: bold is a compatibility alias for semibold.
// Numeric axis values preserve Motion's font-weight interpolation.
const semibold = "'wght' 600";
export const fontWeights = {
  normal: "'wght' 400",
  medium: "'wght' 500",
  semibold,
  bold: semibold,
} as const;
