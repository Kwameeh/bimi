import { useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';

import { api } from '../../convex/_generated/api';

export default function NewChatScreen() {
  const theme = useTheme();
  const router = useRouter();
  const instance = useInstance();
  const [queryText, setQueryText] = useState('');

  const allContacts = useQuery(api.contacts.listContacts, {
    instance,
    limit: 200,
  });
  const searchResults = useQuery(
    api.contacts.searchContacts,
    queryText.trim().length > 0 ? { instance, queryText: queryText.trim(), limit: 50 } : 'skip',
  );

  const contacts = queryText.trim().length > 0 ? searchResults : allContacts;

  const sorted = useMemo(() => {
    if (!contacts) return undefined;
    return [...contacts].sort((a, b) =>
      (a.displayName ?? a.remoteJid).localeCompare(b.displayName ?? b.remoteJid),
    );
  }, [contacts]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText type="subtitle">New chat</ThemedText>
          <View style={{ width: 50 }} />
        </View>
        <View style={[styles.inputWrap, { backgroundColor: theme.backgroundElement }]}>
          <TextInput
            value={queryText}
            onChangeText={setQueryText}
            placeholder="Search contacts"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text }]}
          />
        </View>

        {sorted === undefined ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : sorted.length === 0 ? (
          <View style={styles.center}>
            <ThemedText type="small" themeColor="textSecondary">
              No contacts.
            </ThemedText>
          </View>
        ) : (
          <FlatList
            contentInsetAdjustmentBehavior="automatic"
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            data={sorted}
            keyExtractor={(c) => c._id}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.border }]} />
            )}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Start chat with ${item.displayName ?? item.remoteJid}`}
                onPress={() =>
                  router.replace({
                    pathname: '/chat/[contactId]',
                    params: { contactId: item._id },
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}
              >
                <Avatar
                  name={item.displayName}
                  isGroup={item.remoteJid.endsWith('@g.us')}
                  size={44}
                  imageUrl={item.avatarUrl ?? undefined}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText type="smallBold">{item.displayName ?? item.remoteJid}</ThemedText>
                  {item.phoneNumber ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.phoneNumber}
                    </ThemedText>
                  ) : null}
                </View>
              </Pressable>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputWrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: { paddingVertical: 12, fontSize: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
