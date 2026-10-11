import { useAction, useMutation, useQuery } from 'convex/react';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';
import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

type Props = {
  instance: string;
  contactId: Id<'contacts'>;
};

type Variant = 'regenerate' | 'shorter' | 'professional' | 'friendly' | 'custom';

const VARIANT_LABELS: Array<{ key: Variant; label: string }> = [
  { key: 'regenerate', label: 'Regenerate' },
  { key: 'shorter', label: 'Shorter' },
  { key: 'professional', label: 'Professional' },
  { key: 'friendly', label: 'Friendlier' },
];

export function DraftsPill({ instance, contactId }: Props) {
  const theme = useTheme();
  const drafts = useQuery(api.drafts.list, {
    instance,
    contactId,
    status: 'pending',
    limit: 10,
  });
  const updateText = useMutation(api.drafts.updateText);
  const rejectDraft = useMutation(api.drafts.reject);
  const sendDraft = useAction(api.drafts.send);
  const regenerate = useAction(api.messageActions.regenerateDraft);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Id<'drafts'> | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState<Id<'drafts'> | null>(null);
  const [busyVariant, setBusyVariant] = useState<Variant | null>(null);
  const [customDraft, setCustomDraft] = useState<Id<'drafts'> | null>(null);
  const [customTone, setCustomTone] = useState('');

  if (!drafts || drafts.length === 0) return null;

  const startEdit = (draftId: Id<'drafts'>, text: string) => {
    setEditing(draftId);
    setEditText(text);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(editing);
    try {
      await updateText({ draftId: editing, text: editText.trim() });
      setEditing(null);
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const send = async (draftId: Id<'drafts'>) => {
    setBusy(draftId);
    try {
      await sendDraft({ draftId });
    } catch (err) {
      Alert.alert('Send failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const reject = async (draftId: Id<'drafts'>) => {
    setBusy(draftId);
    try {
      await rejectDraft({ draftId });
    } catch (err) {
      Alert.alert('Reject failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const applyVariant = async (
    draftId: Id<'drafts'>,
    variant: Variant,
    custom?: string,
  ) => {
    setBusy(draftId);
    setBusyVariant(variant);
    try {
      await regenerate({
        draftId,
        variant,
        customTone: variant === 'custom' ? custom : undefined,
      });
      if (variant === 'custom') {
        setCustomDraft(null);
        setCustomTone('');
      }
    } catch (err) {
      Alert.alert('Regenerate failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setBusyVariant(null);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: theme.aiAccent, opacity: pressed ? 0.85 : 1 },
        ]}>
        <Text style={[styles.pillText, { color: '#FFFFFF' }]}>
          ✦ {drafts.length} draft{drafts.length > 1 ? 's' : ''} ready
        </Text>
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingContainer style={{ flex: 1 }}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}
            onPress={(e) => e.stopPropagation()}>
            <ThemedText type="smallBold" style={styles.title}>
              Drafts awaiting approval
            </ThemedText>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              {drafts.map((d) => {
                const isBusy = busy === d._id;
                return (
                  <View
                    key={d._id}
                    style={[
                      styles.card,
                      { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                    ]}>
                    {editing === d._id ? (
                      <TextInput
                        value={editText}
                        onChangeText={setEditText}
                        multiline
                        style={[
                          styles.input,
                          {
                            color: theme.text,
                            borderColor: theme.border,
                            backgroundColor: theme.background,
                          },
                        ]}
                      />
                    ) : (
                      <Text style={[styles.draftText, { color: theme.text }]}>{d.text}</Text>
                    )}

                    {editing === d._id ? (
                      <View style={styles.cardActions}>
                        <Pressable
                          onPress={() => setEditing(null)}
                          style={[styles.btn, { borderColor: theme.border }]}>
                          <Text style={{ color: theme.text }}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={saveEdit}
                          disabled={isBusy}
                          style={[
                            styles.btn,
                            styles.btnPrimary,
                            { backgroundColor: theme.primary },
                          ]}>
                          {isBusy ? (
                            <ActivityIndicator size="small" color={theme.primaryText} />
                          ) : (
                            <Text style={{ color: theme.primaryText, fontWeight: '700' }}>
                              Save
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    ) : (
                      <>
                        <View style={styles.variantRow}>
                          {VARIANT_LABELS.map((v) => (
                            <Pressable
                              key={v.key}
                              onPress={() => applyVariant(d._id, v.key)}
                              disabled={isBusy}
                              style={[
                                styles.chip,
                                { borderColor: theme.border },
                                isBusy && { opacity: 0.5 },
                              ]}>
                              {isBusy && busyVariant === v.key ? (
                                <ActivityIndicator size="small" color={theme.text} />
                              ) : (
                                <Text style={[styles.chipText, { color: theme.text }]}>
                                  {v.label}
                                </Text>
                              )}
                            </Pressable>
                          ))}
                          <Pressable
                            onPress={() => {
                              setCustomDraft(d._id);
                              setCustomTone('');
                            }}
                            disabled={isBusy}
                            style={[
                              styles.chip,
                              { borderColor: theme.border },
                              isBusy && { opacity: 0.5 },
                            ]}>
                            <Text style={[styles.chipText, { color: theme.text }]}>
                              Custom…
                            </Text>
                          </Pressable>
                        </View>

                        {customDraft === d._id ? (
                          <View style={{ gap: 8 }}>
                            <TextInput
                              value={customTone}
                              onChangeText={setCustomTone}
                              placeholder='e.g. "in pidgin" or "more apologetic"'
                              placeholderTextColor={theme.textSecondary}
                              style={[
                                styles.input,
                                {
                                  color: theme.text,
                                  borderColor: theme.border,
                                  backgroundColor: theme.background,
                                  minHeight: 44,
                                },
                              ]}
                            />
                            <View style={styles.cardActions}>
                              <Pressable
                                onPress={() => {
                                  setCustomDraft(null);
                                  setCustomTone('');
                                }}
                                style={[styles.btn, { borderColor: theme.border }]}>
                                <Text style={{ color: theme.text }}>Cancel</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => applyVariant(d._id, 'custom', customTone)}
                                disabled={isBusy || customTone.trim().length === 0}
                                style={[
                                  styles.btn,
                                  styles.btnPrimary,
                                  { backgroundColor: theme.primary },
                                  (isBusy || customTone.trim().length === 0) && {
                                    opacity: 0.5,
                                  },
                                ]}>
                                {isBusy && busyVariant === 'custom' ? (
                                  <ActivityIndicator
                                    size="small"
                                    color={theme.primaryText}
                                  />
                                ) : (
                                  <Text
                                    style={{ color: theme.primaryText, fontWeight: '700' }}>
                                    Apply
                                  </Text>
                                )}
                              </Pressable>
                            </View>
                          </View>
                        ) : null}

                        <View style={styles.cardActions}>
                          <Pressable
                            onPress={() => reject(d._id)}
                            disabled={isBusy}
                            style={[styles.btn, { borderColor: theme.border }]}>
                            <Text style={{ color: theme.danger ?? '#EF4444' }}>Reject</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => startEdit(d._id, d.text)}
                            disabled={isBusy}
                            style={[styles.btn, { borderColor: theme.border }]}>
                            <Text style={{ color: theme.text }}>Edit</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => send(d._id)}
                            disabled={isBusy}
                            style={[
                              styles.btn,
                              styles.btnPrimary,
                              { backgroundColor: theme.primary },
                            ]}>
                            {isBusy && busyVariant === null ? (
                              <ActivityIndicator size="small" color={theme.primaryText} />
                            ) : (
                              <Text
                                style={{ color: theme.primaryText, fontWeight: '700' }}>
                                Send
                              </Text>
                            )}
                          </Pressable>
                        </View>
                      </>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
          </Pressable>
        </KeyboardAvoidingContainer>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: { fontSize: 12, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 16,
    paddingBottom: 28,
    maxHeight: '85%',
    gap: 12,
  },
  title: { marginBottom: 4 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  draftText: { fontSize: 15, lineHeight: 20 },
  input: {
    minHeight: 60,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
  },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
});
