import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppIcon } from '@/components/ui/app-icon';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInstance } from '@/lib/instance';
import {
  addDeviceContactsChangeListener,
  createDeviceContact,
  getContactPermissionState,
  readDeviceContacts,
  requestContactPermission,
  type ContactPermissionState,
} from '@/services/contact-sync';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

type SyncContact = {
  _id: Id<'contacts'>;
  displayName?: string;
  pushName?: string;
  phoneNumber?: string;
  normalizedPhone?: string;
  syncStatus?: 'synced' | 'pending_phone_create' | 'pending_cloud_import' | 'failed';
  syncError?: string;
  deviceContactId?: string;
  lastDeviceSyncedAt?: number;
};

function getPermissionCopy(permission: ContactPermissionState) {
  switch (permission) {
    case 'unsupported':
      return 'Phone contact sync is available on iOS and Android devices.';
    case 'granted':
      return 'Phone contact access is enabled.';
    case 'limited':
      return 'Limited contact access is enabled.';
    case 'denied':
      return 'Contact access is denied in system settings.';
    default:
      return 'Contact access is needed before Bimi can match your phone contacts.';
  }
}

function contactName(contact: SyncContact) {
  return (
    contact.displayName ??
    contact.pushName ??
    contact.phoneNumber ??
    contact.normalizedPhone ??
    'Unnamed'
  );
}

function contactPhone(contact: SyncContact) {
  return contact.phoneNumber ?? contact.normalizedPhone ?? 'No phone number';
}

function formatSyncTime(value?: number) {
  if (!value) return 'Not synced yet';
  return new Date(value).toLocaleString();
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export default function ContactsSyncScreen() {
  const router = useRouter();
  const theme = useTheme();
  const instance = useInstance();

  const pendingContacts = useQuery(api.contacts.listSyncCandidates, {
    instance,
    status: 'pending_phone_create',
    limit: 50,
  }) as SyncContact[] | undefined;
  const failedContacts = useQuery(api.contacts.listSyncCandidates, {
    instance,
    status: 'failed',
    limit: 20,
  }) as SyncContact[] | undefined;

  const upsertFromDeviceBatch = useMutation(api.contacts.upsertFromDeviceBatch);
  const markExportedToDevice = useMutation(api.contacts.markExportedToDevice);
  const markSyncFailed = useMutation(api.contacts.markSyncFailed);

  const [permission, setPermission] = useState<ContactPermissionState>('undetermined');
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string>('No phone sync has run yet.');
  const [exportingIds, setExportingIds] = useState<Record<string, boolean>>({});

  const loadPermission = useCallback(async () => {
    const state = await getContactPermissionState();
    setPermission(state);
    return state;
  }, []);

  const syncFromDevice = useCallback(async () => {
    const state = await loadPermission();
    if (state !== 'granted' && state !== 'limited') {
      setSyncSummary(getPermissionCopy(state));
      return;
    }

    setSyncing(true);
    try {
      const contacts = await readDeviceContacts();
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const chunk of chunkArray(contacts, 100)) {
        const result = await upsertFromDeviceBatch({ instance, contacts: chunk });
        inserted += result.inserted;
        updated += result.updated;
        skipped += result.skipped;
      }

      setSyncSummary(
        `Imported ${inserted} new, updated ${updated}, skipped ${skipped}. Checked ${contacts.length} phone contacts.`,
      );
    } catch (error) {
      setSyncSummary(error instanceof Error ? error.message : 'Phone contact sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [instance, loadPermission, upsertFromDeviceBatch]);

  const requestPermissionAndSync = useCallback(async () => {
    const state = await requestContactPermission();
    setPermission(state);
    if (state === 'granted' || state === 'limited') {
      await syncFromDevice();
    } else {
      setSyncSummary(getPermissionCopy(state));
    }
  }, [syncFromDevice]);

  const exportContact = useCallback(
    async (contact: SyncContact) => {
      const phoneNumber = contact.phoneNumber ?? contact.normalizedPhone;
      if (!phoneNumber) {
        await markSyncFailed({
          contactId: contact._id,
          syncError: 'A phone number is required before this contact can be exported.',
        });
        return;
      }

      setExportingIds((current) => ({ ...current, [contact._id]: true }));
      try {
        const deviceContactId = await createDeviceContact({
          name: contactName(contact),
          phoneNumber,
        });
        await markExportedToDevice({
          contactId: contact._id,
          deviceContactId,
          deviceContactName: contactName(contact),
        });
      } catch (error) {
        await markSyncFailed({
          contactId: contact._id,
          syncError: error instanceof Error ? error.message : 'Could not create phone contact.',
        });
      } finally {
        setExportingIds((current) => ({ ...current, [contact._id]: false }));
      }
    },
    [markExportedToDevice, markSyncFailed],
  );

  useEffect(() => {
    let active = true;
    void getContactPermissionState().then((state) => {
      if (active) setPermission(state);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (permission !== 'granted' && permission !== 'limited') return undefined;
    const subscription = addDeviceContactsChangeListener(() => {
      void syncFromDevice();
    });
    return () => subscription?.remove();
  }, [permission, syncFromDevice]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (permission === 'granted' || permission === 'limited')) {
        void syncFromDevice();
      }
    });
    return () => subscription.remove();
  }, [permission, syncFromDevice]);

  const pendingCount = pendingContacts?.length ?? 0;
  const failedCount = failedContacts?.length ?? 0;
  const canReadContacts = permission === 'granted' || permission === 'limited';

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.headerBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              hitSlop={12}
              style={styles.backBtn}
            >
              <AppIcon name="back" tintColor={theme.primary} size={22} />
            </Pressable>
          </View>
          <View style={styles.header}>
            <View style={[styles.iconBadge, { backgroundColor: theme.backgroundElement }]}>
              <SymbolView
                tintColor={theme.text}
                name={{ ios: 'person.crop.circle.badge.checkmark', android: 'sync', web: 'sync' }}
                size={28}
              />
            </View>
            <View style={styles.headerText}>
              <ThemedText type="subtitle">Contact sync</ThemedText>
              <ThemedText themeColor="textSecondary">
                Match Bimi cloud contacts with the phone address book for instance {instance}.
              </ThemedText>
            </View>
          </View>

          <ThemedView type="backgroundElement" style={styles.statusPanel}>
            <View style={styles.statusRow}>
              <View style={styles.statusText}>
                <ThemedText type="smallBold">Phone contacts</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {getPermissionCopy(permission)}
                </ThemedText>
              </View>
              <Pressable
                disabled={syncing || permission === 'unsupported'}
                onPress={canReadContacts ? syncFromDevice : requestPermissionAndSync}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.text },
                  (pressed || syncing) && styles.pressed,
                ]}
              >
                <SymbolView
                  tintColor={theme.background}
                  name={{
                    ios: canReadContacts ? 'arrow.triangle.2.circlepath' : 'person.badge.plus',
                    android: 'sync',
                    web: 'sync',
                  }}
                  size={16}
                />
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  {syncing ? 'Syncing' : canReadContacts ? 'Sync now' : 'Allow'}
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {syncSummary}
            </ThemedText>
          </ThemedView>

          <View style={styles.metrics}>
            <Metric label="Needs phone export" value={String(pendingCount)} />
            <Metric label="Failed syncs" value={String(failedCount)} />
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Cloud contacts to add to phone</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Bimi will only create these phone contacts after you approve each one.
            </ThemedText>
            <View style={styles.list}>
              {pendingContacts === undefined ? (
                <EmptyState label="Loading contacts..." />
              ) : pendingContacts.length === 0 ? (
                <EmptyState label="No cloud contacts are waiting for phone export." />
              ) : (
                pendingContacts.map((contact) => (
                  <ContactRow
                    key={contact._id}
                    contact={contact}
                    actionLabel={exportingIds[contact._id] ? 'Adding' : 'Add'}
                    disabled={Boolean(exportingIds[contact._id]) || permission === 'unsupported'}
                    onPress={() => exportContact(contact)}
                  />
                ))
              )}
            </View>
          </View>

          {failedCount > 0 && (
            <View style={styles.section}>
              <ThemedText type="smallBold">Needs attention</ThemedText>
              <View style={styles.list}>
                {failedContacts?.map((contact) => (
                  <ThemedView key={contact._id} type="backgroundElement" style={styles.contactRow}>
                    <View style={styles.contactInfo}>
                      <ThemedText type="smallBold">{contactName(contact)}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {contact.syncError ?? 'Sync failed'}
                      </ThemedText>
                    </View>
                  </ThemedView>
                ))}
              </View>
            </View>
          )}

          {Platform.OS === 'web' && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.webNote}>
              Open this app on a device or simulator to read and write system contacts.
            </ThemedText>
          )}
        </SafeAreaView>
      </ScrollView>
    </ThemedView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.metric}>
      <ThemedText type="title" style={styles.metricValue}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.emptyState}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

function ContactRow({
  contact,
  actionLabel,
  disabled,
  onPress,
}: {
  contact: SyncContact;
  actionLabel: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.contactRow}>
      <View style={styles.contactInfo}>
        <ThemedText type="smallBold">{contactName(contact)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {contactPhone(contact)}
        </ThemedText>
        <ThemedText type="code" themeColor="textSecondary">
          {formatSyncTime(contact.lastDeviceSyncedAt)}
        </ThemedText>
      </View>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.secondaryButton,
          { borderColor: theme.backgroundSelected },
          (pressed || disabled) && styles.pressed,
        ]}
      >
        <SymbolView
          tintColor={theme.text}
          name={{ ios: 'plus.circle', android: 'add_circle', web: 'add_circle' }}
          size={16}
        />
        <ThemedText type="smallBold">{actionLabel}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  safeArea: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.four,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  backBtn: {
    padding: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: Spacing.one,
  },
  statusPanel: {
    borderRadius: 8,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  statusText: {
    flex: 1,
    gap: Spacing.one,
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  secondaryButton: {
    minHeight: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.65,
  },
  metrics: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  metric: {
    flex: 1,
    minHeight: 104,
    borderRadius: 8,
    padding: Spacing.three,
    justifyContent: 'center',
    gap: Spacing.one,
  },
  metricValue: {
    fontSize: 36,
    lineHeight: 40,
  },
  section: {
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.two,
  },
  contactRow: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  contactInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  emptyState: {
    borderRadius: 8,
    padding: Spacing.three,
  },
  webNote: {
    textAlign: 'center',
  },
});
