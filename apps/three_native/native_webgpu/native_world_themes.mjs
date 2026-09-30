export const WORLD_THEMES = Object.freeze([
  { key: 'classic', label: 'Classic', color: 0xeae9e5 },
  { key: 'meadow', label: 'Rolling meadow', color: 0x507f38 },
  { key: 'desert', label: 'Desert dunes', color: 0xd8bb82 },
  { key: 'tropical', label: 'Tropical island', color: 0x41aeb2 },
  { key: 'lunar', label: 'Lunar surface', color: 0x92969d },
]);

export function worldTheme(value) {
  const requested = String(value || '').toLowerCase();
  return WORLD_THEMES.find(theme => theme.key === requested ||
    theme.label.toLowerCase() === requested)?.key || 'classic';
}
