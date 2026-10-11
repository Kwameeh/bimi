import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

const TABS = [
  { name: 'index', href: '/', label: 'Chats', icon: 'menu' },
  { name: 'assistant', href: '/assistant', label: 'Assistant', icon: 'sparkles' },
  { name: 'briefing', href: '/briefing', label: 'Briefing', icon: 'document' },
  { name: 'tasks', href: '/tasks', label: 'Tasks', icon: 'checkDouble' },
  { name: 'settings', href: '/settings', label: 'Settings', icon: 'settings' },
] as const;

export default function AppTabs() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const wide = React.useSyncExternalStore(subscribeToViewport, getWideViewport, () => false);
  // Tabs wraps its own style in an array. Flatten ours first so the web DOM
  // never receives a nested style array when switching to the wide layout.
  const shellStyle = StyleSheet.flatten([styles.shell, wide ? styles.shellWide : null]);
  const tabListStyle = StyleSheet.flatten([
    wide ? styles.sidebar : styles.bottomBar,
    { backgroundColor: theme.surface },
    !wide ? { paddingBottom: Math.max(insets.bottom, 10) } : null,
  ]);

  return (
    <Tabs style={shellStyle}>
      <TabSlot style={styles.slot} />
      <TabList style={tabListStyle}>
        {wide ? (
          <ThemedText style={styles.brand} accessibilityRole="header">
            Bimi
          </ThemedText>
        ) : null}
        {TABS.map((item) => (
          <TabTrigger key={item.name} name={item.name} href={item.href} asChild>
            <TabButton label={item.label} icon={item.icon} wide={wide} />
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

function subscribeToViewport(onStoreChange: () => void) {
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

function getWideViewport() {
  return window.innerWidth >= 900;
}

function TabButton({
  label,
  icon,
  wide,
  isFocused,
  ...props
}: TabTriggerSlotProps & {
  label: string;
  icon: AppIconName;
  wide: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      {...props}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tabButton,
        wide ? styles.tabButtonWide : styles.tabButtonCompact,
        isFocused && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}
    >
      <AppIcon
        name={icon}
        tintColor={isFocused ? theme.primary : theme.textSecondary}
        size={wide ? 20 : 19}
      />
      <ThemedText
        numberOfLines={1}
        style={[
          styles.tabLabel,
          !wide && styles.tabLabelCompact,
          { color: isFocused ? theme.primary : theme.textSecondary },
        ]}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, minWidth: 0 },
  shellWide: { flexDirection: 'row-reverse' },
  slot: { flex: 1, minWidth: 0 },
  sidebar: {
    flexDirection: 'column',
    justifyContent: 'flex-start',
    width: 220,
    paddingHorizontal: 14,
    paddingVertical: 24,
    gap: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(100,116,139,0.28)',
  },
  brand: { fontSize: 24, lineHeight: 30, fontWeight: '800', padding: 12, marginBottom: 12 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(100,116,139,0.28)',
  },
  tabButton: { alignItems: 'center', justifyContent: 'center' },
  tabButtonWide: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 12,
  },
  tabButtonCompact: { flex: 1, minWidth: 0, minHeight: 50, gap: 3 },
  tabLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  tabLabelCompact: { fontSize: 10, lineHeight: 12, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
