import { useAction } from 'convex/react';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { api } from '../../../convex/_generated/api';
import type { Doc } from '../../../convex/_generated/dataModel';

type AskedOption = { label?: string; description?: string };
type AskedQuestion = {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: AskedOption[];
};
type AnsweredQuestion = {
  header?: string;
  question?: string;
  selected?: string[];
  other?: string;
};

type QuestionState = {
  selected: Set<string>;
  otherActive: boolean;
  otherText: string;
};

const OTHER = '__other__';

type Props = {
  row: Doc<'assistantMessages'>;
};

export function QuestionCard({ row }: Props) {
  if (row.toolName === 'askUserForChoice') {
    return <LegacyChoiceCard row={row} />;
  }
  return <RichQuestionCard row={row} />;
}

/* ------------------------------------------------------------------ */
/* Legacy askUserForChoice: question + plain string chips              */
/* ------------------------------------------------------------------ */

function LegacyChoiceCard({ row }: Props) {
  const theme = useTheme();
  const [choosing, setChoosing] = useState(false);
  const submitChoice = useAction(api.assistant.submitChoice);

  const args = (row.toolArgs ?? {}) as { question?: string; options?: string[] };
  const question = args.question ?? 'Pick one';
  const options = Array.isArray(args.options) ? args.options : [];
  const status = row.status ?? 'done';

  if (status !== 'awaiting_choice') {
    const chosen = (row.toolResult as { chosen?: string } | undefined)?.chosen;
    return (
      <AnsweredSummary
        rows={[{ header: null, question, value: chosen ?? null }]}
        cancelled={status === 'cancelled'}
      />
    );
  }

  const onChoose = async (choice: string) => {
    if (choosing) return;
    setChoosing(true);
    try {
      await submitChoice({ choiceMessageId: row._id, choice });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setChoosing(false);
    }
  };

  return (
    <View
      style={[styles.card, { borderColor: '#F59E0B', backgroundColor: theme.backgroundElement }]}
    >
      <Text style={[styles.question, { color: theme.text }]}>{question}</Text>
      <View style={styles.chipRow}>
        {options.map((opt) => (
          <Pressable
            key={opt}
            onPress={() => onChoose(opt)}
            disabled={choosing}
            style={[
              styles.chip,
              { borderColor: theme.border, backgroundColor: theme.background },
              choosing && { opacity: 0.5 },
            ]}
          >
            <Text style={{ color: theme.text, fontWeight: '600', fontSize: 12 }}>{opt}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* New askUserQuestion: full-width option rows, multi-question         */
/* ------------------------------------------------------------------ */

function RichQuestionCard({ row }: Props) {
  const theme = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const submitAnswers = useAction(api.assistant.submitAnswers);

  const questions = useMemo<AskedQuestion[]>(() => {
    const args = (row.toolArgs ?? {}) as { questions?: AskedQuestion[] };
    return Array.isArray(args.questions) ? args.questions : [];
  }, [row.toolArgs]);

  const [state, setState] = useState<QuestionState[]>(() =>
    questions.map(() => ({ selected: new Set(), otherActive: false, otherText: '' })),
  );

  const status = row.status ?? 'done';

  if (status !== 'awaiting_questions') {
    const answers = (row.toolResult as { answers?: AnsweredQuestion[] } | undefined)?.answers ?? [];
    return (
      <AnsweredSummary
        rows={
          answers.length > 0
            ? answers.map((a) => ({
                header: a.header ?? null,
                question: a.question ?? '',
                value: a.other ?? a.selected?.join(', ') ?? null,
              }))
            : questions.map((q) => ({
                header: q.header ?? null,
                question: q.question ?? '',
                value: null,
              }))
        }
        cancelled={status === 'cancelled'}
      />
    );
  }

  // Submit-on-tap only for the simplest shape: one single-select question.
  const instantSubmit = questions.length === 1 && questions[0]?.multiSelect !== true;

  const isAnswered = (s: QuestionState): boolean =>
    s.otherActive ? s.otherText.trim().length > 0 : s.selected.size > 0;
  const allAnswered = state.every(isAnswered);

  const doSubmit = async (next: QuestionState[]) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitAnswers({
        questionMessageId: row._id,
        answers: questions.map((q, i) => {
          const s = next[i];
          const other = s.otherActive ? s.otherText.trim() : '';
          return {
            header: q.header ?? '',
            selected: other ? [other] : [...s.selected],
            other: other || undefined,
          };
        }),
      });
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onToggle = (qi: number, label: string) => {
    if (submitting) return;
    const q = questions[qi];
    const next = state.map((s, i) => {
      if (i !== qi) return s;
      const selected = new Set(s.selected);
      let otherActive = s.otherActive;
      if (label === OTHER) {
        otherActive = !otherActive;
        if (otherActive && q.multiSelect !== true) selected.clear();
      } else if (q.multiSelect === true) {
        otherActive = false;
        if (selected.has(label)) selected.delete(label);
        else selected.add(label);
      } else {
        otherActive = false;
        selected.clear();
        selected.add(label);
      }
      return { ...s, selected, otherActive };
    });
    setState(next);
    if (instantSubmit && label !== OTHER) {
      void doSubmit(next);
    }
  };

  const setOtherText = (qi: number, text: string) => {
    setState((prev) => prev.map((s, i) => (i === qi ? { ...s, otherText: text } : s)));
  };

  const showSubmit = !instantSubmit || state.some((s) => s.otherActive);

  return (
    <View
      style={[styles.card, { borderColor: '#F59E0B', backgroundColor: theme.backgroundElement }]}
    >
      {questions.map((q, qi) => {
        const s = state[qi];
        const multi = q.multiSelect === true;
        return (
          <View key={qi} style={qi > 0 ? styles.questionSection : undefined}>
            <View style={styles.questionHead}>
              {q.header ? (
                <View
                  style={[
                    styles.headerChip,
                    { backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.headerChipText, { color: theme.textSecondary }]}>
                    {q.header}
                  </Text>
                </View>
              ) : null}
              <Text style={[styles.question, { color: theme.text }]}>{q.question ?? ''}</Text>
            </View>

            {(q.options ?? []).map((opt, oi) => {
              const label = opt.label ?? '';
              const active = !s.otherActive && s.selected.has(label);
              return (
                <OptionRow
                  key={`${oi}-${label}`}
                  label={label}
                  description={opt.description ?? ''}
                  selected={active}
                  multi={multi}
                  disabled={submitting}
                  onPress={() => onToggle(qi, label)}
                  theme={theme}
                />
              );
            })}

            <OptionRow
              label="Other…"
              description={s.otherActive ? '' : 'Type your own answer'}
              selected={s.otherActive}
              multi={false}
              disabled={submitting}
              onPress={() => onToggle(qi, OTHER)}
              theme={theme}
            />
            {s.otherActive ? (
              <TextInput
                value={s.otherText}
                onChangeText={(t) => setOtherText(qi, t)}
                placeholder="Type your answer"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                editable={!submitting}
                style={[
                  styles.otherInput,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.background,
                  },
                ]}
              />
            ) : null}
          </View>
        );
      })}

      {showSubmit ? (
        <Pressable
          onPress={() => doSubmit(state)}
          disabled={submitting || !allAnswered}
          style={[
            styles.submitBtn,
            { backgroundColor: theme.primary },
            (submitting || !allAnswered) && { opacity: 0.4 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={theme.primaryText} />
          ) : (
            <Text style={{ color: theme.primaryText, fontWeight: '700' }}>Submit</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function OptionRow({
  label,
  description,
  selected,
  multi,
  disabled,
  onPress,
  theme,
}: {
  label: string;
  description: string;
  selected: boolean;
  multi: boolean;
  disabled: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.optionRow,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: theme.background,
        },
        selected && { borderWidth: 1.5 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View
        style={[
          styles.selector,
          multi ? styles.selectorSquare : styles.selectorRound,
          { borderColor: selected ? theme.primary : theme.textSecondary },
          selected && { backgroundColor: theme.primary },
        ]}
      >
        {selected ? (
          <Text style={[styles.selectorMark, { color: theme.primaryText }]}>✓</Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, { color: theme.text }]}>{label}</Text>
        {description.length > 0 ? (
          <Text style={[styles.optionDescription, { color: theme.textSecondary }]}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Compact answered / cancelled state                                  */
/* ------------------------------------------------------------------ */

function AnsweredSummary({
  rows,
  cancelled,
}: {
  rows: { header: string | null; question: string; value: string | null }[];
  cancelled: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.answeredCard,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      {rows.map((r, i) => (
        <View key={i} style={styles.answeredRow}>
          {r.header ? (
            <View
              style={[
                styles.headerChip,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.headerChipText, { color: theme.textSecondary }]}>
                {r.header}
              </Text>
            </View>
          ) : (
            <Text
              numberOfLines={1}
              style={[styles.answeredQuestion, { color: theme.textSecondary }]}
            >
              {r.question}
            </Text>
          )}
          <Text
            numberOfLines={2}
            style={[styles.answeredValue, { color: cancelled ? theme.textSecondary : theme.text }]}
          >
            {cancelled ? 'Dismissed' : (r.value ?? '—')}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginVertical: 4,
  },
  questionSection: {
    marginTop: 8,
    gap: 8,
  },
  questionHead: { gap: 6, marginBottom: 2 },
  headerChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  headerChipText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  question: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 2,
  },
  selector: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorRound: { borderRadius: 9 },
  selectorSquare: { borderRadius: 4 },
  selectorMark: { fontSize: 11, fontWeight: '800', lineHeight: 13 },
  optionLabel: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  optionDescription: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  otherInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    marginVertical: 2,
  },
  submitBtn: {
    marginTop: 6,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answeredCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    marginVertical: 3,
  },
  answeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  answeredQuestion: { fontSize: 12, flexShrink: 1 },
  answeredValue: { fontSize: 13, fontWeight: '600', flex: 1 },
});
