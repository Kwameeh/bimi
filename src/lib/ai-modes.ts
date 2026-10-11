export type AiMode = 'manual' | 'semi_auto' | 'full_auto' | 'silent';

export const AI_MODE_OPTIONS: {
  value: AiMode;
  label: string;
  description: string;
}[] = [
  { value: 'manual', label: 'Manual', description: 'Bimi drafts only — you send.' },
  {
    value: 'semi_auto',
    label: 'Semi-auto',
    description: 'Auto-reply to greetings and acknowledgements only.',
  },
  {
    value: 'full_auto',
    label: 'Full auto',
    description:
      'Answers everything — looks things up first, drafts when unsure. Never sends about money or codes.',
  },
  { value: 'silent', label: 'Silent', description: 'Bimi summarizes — never sends.' },
];
