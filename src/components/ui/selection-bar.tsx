import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Confirm a destructive action.
 *
 * `Alert.alert` is a no-op on react-native-web, so a web user would otherwise
 * get a silent no-op where every other platform gets a confirmation — the worst
 * possible outcome for a delete button.
 */
export function confirmDestructive(args: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${args.title}\n\n${args.message}`)) {
      args.onConfirm();
    }
    return;
  }
  Alert.alert(args.title, args.message, [
    { text: 'Cancel', style: 'cancel' },
    { text: args.confirmLabel, style: 'destructive', onPress: args.onConfirm },
  ]);
}

/**
 * The bar that replaces a list header while the user is picking rows to delete.
 *
 * Deliberately identical on every screen: the same position, the same order of
 * controls, the same wording. Selection mode is a mode, and a mode the user has
 * to re-learn per screen is worse than no mode at all.
 */
export function SelectionBar({
  count,
  total,
  noun,
  busy = false,
  onSelectAll,
  onDelete,
  onCancel,
}: {
  count: number;
  /** Rows currently on screen — select-all respects the active filter. */
  total: number;
  /** Singular noun for the confirmation copy, e.g. "task". */
  noun: string;
  busy?: boolean;
  onSelectAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const allSelected = count > 0 && count >= total;
  const label = count === 1 ? `1 ${noun} selected` : `${count} ${noun}s selected`;

  return (
    <View
      style={[styles.bar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      <Pressable onPress={onCancel} hitSlop={8} disabled={busy}>
        <Text style={[styles.action, { color: theme.text }]}>Cancel</Text>
      </Pressable>

      <Text style={[styles.count, { color: theme.textSecondary }]} numberOfLines={1}>
        {count === 0 ? `Select ${noun}s` : label}
      </Text>

      <Pressable onPress={onSelectAll} hitSlop={8} disabled={busy || total === 0}>
        <Text style={[styles.action, { color: total === 0 ? theme.textSecondary : theme.primary }]}>
          {allSelected ? 'None' : 'All'}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          if (count === 0 || busy) return;
          confirmDestructive({
            title: count === 1 ? `Delete this ${noun}?` : `Delete ${count} ${noun}s?`,
            message: 'This cannot be undone.',
            confirmLabel: 'Delete',
            onConfirm: onDelete,
          });
        }}
        hitSlop={8}
        disabled={count === 0 || busy}
        style={[
          styles.deleteBtn,
          {
            backgroundColor: count === 0 ? 'transparent' : theme.danger,
            borderColor: count === 0 ? theme.border : theme.danger,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text
            style={[styles.deleteText, { color: count === 0 ? theme.textSecondary : '#FFFFFF' }]}
          >
            Delete
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/** The affordance that gets a user into selection mode from a normal header. */
export function SelectButton({
  onPress,
  disabled,
  label = 'Select',
}: {
  onPress: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} disabled={disabled}>
      <Text style={[styles.action, { color: disabled ? theme.textSecondary : theme.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The checkbox shown on the left of a row in selection mode. Kept here so every
 * list reads the same, rather than each screen inventing its own tick.
 */
export function SelectionCheck({ checked }: { checked: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.check,
        { borderColor: theme.border },
        checked && { backgroundColor: theme.primary, borderColor: theme.primary },
      ]}
    >
      {checked ? (
        <Text style={{ color: theme.primaryText, fontWeight: '800', fontSize: 13 }}>✓</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  count: { flex: 1, fontSize: 13, fontWeight: '600' },
  action: { fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    minWidth: 74,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deleteText: { fontSize: 14, fontWeight: '700' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
