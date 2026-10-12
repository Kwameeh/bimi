import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { useTheme } from '@/hooks/use-theme';

const TABS = [
  { name: 'index', href: '/', label: 'Chats', icon: 'chat' },
  { name: 'assistant', href: '/assistant', label: 'Assistant', icon: 'sparkles' },
  { name: 'briefing', href: '/briefing', label: 'Briefing', icon: 'newspaper' },
  { name: 'tasks', href: '/tasks', label: 'Tasks', icon: 'checklist' },
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
          <View style={styles.brandContainer}>
            <View style={[styles.brandIconWrap, { backgroundColor: theme.primary }]}>
              <AppIcon name="sparkles" tintColor="#FFFFFF" size={18} />
            </View>
            <ThemedText style={styles.brand} accessibilityRole="header">
              Bimi
            </ThemedText>
          </View>
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
        wide && isFocused && { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          !wide && isFocused && { backgroundColor: theme.backgroundSelected },
        ]}
      >
        <AppIcon
          name={icon}
          tintColor={isFocused ? theme.primary : theme.textSecondary}
          size={wide ? 20 : 19}
        />
      </View>
      <ThemedText
        numberOfLines={1}
        style={[
          styles.tabLabel,
          !wide && styles.tabLabelCompact,
          { color: isFocused ? theme.primary : theme.textSecondary },
          isFocused && { fontWeight: '700' },
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
    width: 240,
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(100,116,139,0.22)',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  brandIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  brand: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.3 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(100,116,139,0.22)',
  },
  tabButton: { alignItems: 'center', justifyContent: 'center' },
  tabButtonWide: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 12,
  },
  tabButtonCompact: { flex: 1, minWidth: 0, minHeight: 52, gap: 2 },
  iconWrap: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  tabLabelCompact: { fontSize: 11, lineHeight: 14, fontWeight: '600', marginTop: 1 },
  pressed: { opacity: 0.65 },
});
