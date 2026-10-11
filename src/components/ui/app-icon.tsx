import { SymbolView, type SymbolViewProps } from 'expo-symbols';

type PlatformSymbol = Extract<SymbolViewProps['name'], object>;

const symbols = {
  add: { ios: 'plus', android: 'add', web: 'add' },
  back: {
    ios: 'chevron.left',
    android: 'arrow_back_ios_new',
    web: 'arrow_back_ios_new',
  },
  arrowDown: { ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' },
  arrowUpRight: {
    ios: 'arrow.up.right',
    android: 'arrow_outward',
    web: 'arrow_outward',
  },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  chevronDown: {
    ios: 'chevron.down',
    android: 'keyboard_arrow_down',
    web: 'keyboard_arrow_down',
  },
  chevronUp: {
    ios: 'chevron.up',
    android: 'keyboard_arrow_up',
    web: 'keyboard_arrow_up',
  },
  dot: {
    ios: 'circle.fill',
    android: 'fiber_manual_record',
    web: 'fiber_manual_record',
  },
  error: {
    ios: 'exclamationmark.triangle.fill',
    android: 'error',
    web: 'error',
  },
  checkDouble: {
    ios: 'checkmark.circle.fill',
    android: 'done_all',
    web: 'done_all',
  },
  chevronRight: {
    ios: 'chevron.right',
    android: 'chevron_right',
    web: 'chevron_right',
  },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  compose: {
    ios: 'square.and.pencil',
    android: 'edit_square',
    web: 'edit_square',
  },
  document: { ios: 'doc.fill', android: 'description', web: 'description' },
  external: {
    ios: 'arrow.up.right.square',
    android: 'open_in_new',
    web: 'open_in_new',
  },
  knowledge: {
    ios: 'books.vertical.fill',
    android: 'library_books',
    web: 'library_books',
  },
  menu: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' },
  mic: { ios: 'mic.fill', android: 'mic', web: 'mic' },
  micOff: { ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' },
  pause: { ios: 'pause.fill', android: 'pause', web: 'pause' },
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  send: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  sparkles: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  stop: { ios: 'stop.fill', android: 'stop', web: 'stop' },
  waveform: { ios: 'waveform', android: 'graphic_eq', web: 'graphic_eq' },
} as const satisfies Record<string, PlatformSymbol>;

export type AppIconName = keyof typeof symbols;

type Props = Omit<SymbolViewProps, 'name' | 'fallback'> & {
  name: AppIconName;
};

/** Cross-platform icon with an SF Symbol and Material Symbols equivalent. */
export function AppIcon({ name, ...props }: Props) {
  return (
    <SymbolView
      {...props}
      name={symbols[name]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
