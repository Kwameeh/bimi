import { describe, expect, it } from 'vitest';
import {
  describeConfirmationForSpeech,
  matchOption,
  matchVoiceIntent,
  nextSpeakableChunk,
  toSpeakable,
} from './voiceText';

describe('toSpeakable', () => {
  it('flattens contact and message citations to their label', () => {
    expect(
      toSpeakable('[Sarah](contact:k57abc123) asked about [the deadline](message:m9xyz)'),
    ).toBe('Sarah asked about the deadline.');
  });

  it('strips bold, italics and headings', () => {
    expect(toSpeakable('## Today\n**Alvin** needs a _reply_')).toBe('Today. Alvin needs a reply.');
  });

  it('turns bullets into separate sentences', () => {
    expect(toSpeakable('- Alvin: payment flow\n- Mum: call me')).toBe(
      'Alvin: payment flow. Mum: call me.',
    );
  });

  it('keeps numbered list content but drops the markers', () => {
    expect(toSpeakable('1. Reply to Alvin\n2. Confirm the meeting')).toBe(
      'Reply to Alvin. Confirm the meeting.',
    );
  });

  it('drops code fences and unwraps inline code', () => {
    expect(toSpeakable('Run ```js\nconsole.log(1)\n``` then `npm test`')).toBe(
      'Run then npm test.',
    );
  });

  it('does not double up existing terminal punctuation', () => {
    expect(toSpeakable('All clear!')).toBe('All clear!');
    expect(toSpeakable('Anything else?')).toBe('Anything else?');
  });

  it('returns an empty string for empty input', () => {
    expect(toSpeakable('')).toBe('');
    expect(toSpeakable('   \n  ')).toBe('');
  });
});

describe('nextSpeakableChunk', () => {
  it('returns nothing while the tail is still mid-sentence', () => {
    expect(nextSpeakableChunk('Four people need', 0)).toBeNull();
  });

  it('emits a sentence once its boundary arrives', () => {
    const got = nextSpeakableChunk('Four people need you. Alvin asked', 0);
    expect(got?.chunk).toBe('Four people need you.');
    expect(got?.nextIndex).toBe(22);
  });

  it('advances past what was already spoken', () => {
    const text = 'One. Two. Three';
    const first = nextSpeakableChunk(text, 0)!;
    expect(first.chunk).toBe('One.');
    const second = nextSpeakableChunk(text, first.nextIndex)!;
    expect(second.chunk).toBe('Two.');
    expect(nextSpeakableChunk(text, second.nextIndex)).toBeNull();
  });

  it('flushes the trailing fragment when the turn is done', () => {
    const got = nextSpeakableChunk('One. Three', 5, true);
    expect(got?.chunk).toBe('Three');
    expect(got?.nextIndex).toBe(10);
  });

  it('returns null when everything has been spoken', () => {
    expect(nextSpeakableChunk('One.', 4, true)).toBeNull();
  });

  it('handles a sentence ending in a quote or bracket', () => {
    const got = nextSpeakableChunk('He said "ok." Then left', 0);
    expect(got?.chunk).toBe('He said "ok."');
  });
});

describe('matchVoiceIntent', () => {
  it('recognises approvals', () => {
    for (const s of ['yes', 'yeah', 'send it', 'go ahead', 'do it', 'Okay!']) {
      expect(matchVoiceIntent(s)).toBe('approve');
    }
  });

  it('recognises rejections', () => {
    for (const s of ['no', 'cancel', "don't send that", 'never mind']) {
      expect(matchVoiceIntent(s)).toBe('reject');
    }
  });

  it('prefers rejection when both appear', () => {
    expect(matchVoiceIntent("no, don't send it")).toBe('reject');
  });

  it('recognises stop', () => {
    expect(matchVoiceIntent('stop')).toBe('stop');
    expect(matchVoiceIntent('be quiet')).toBe('stop');
  });

  it('does not fire on substrings inside other words', () => {
    expect(matchVoiceIntent('notify the team')).toBe('none');
    expect(matchVoiceIntent('nokia')).toBe('none');
    expect(matchVoiceIntent('broke the build')).toBe('none');
  });

  it('returns none for an ordinary instruction', () => {
    expect(matchVoiceIntent('tell him Friday works')).toBe('none');
    expect(matchVoiceIntent('')).toBe('none');
  });
});

describe('matchOption', () => {
  const labels = ['Alvin Mensah', 'Sarah Owusu', 'Design team'];

  it('matches an exact label', () => {
    expect(matchOption('Sarah Owusu', labels)).toBe(1);
  });

  it('matches a label spoken inside a sentence', () => {
    expect(matchOption('the design team one', labels)).toBe(2);
  });

  it('matches a partial name', () => {
    expect(matchOption('Alvin', labels)).toBe(0);
  });

  it('matches by ordinal', () => {
    expect(matchOption('the first one', labels)).toBe(0);
    expect(matchOption('number two', labels)).toBe(1);
  });

  it('returns null when nothing matches', () => {
    expect(matchOption('something else entirely', labels)).toBeNull();
    expect(matchOption('', labels)).toBeNull();
    expect(matchOption('Alvin', [])).toBeNull();
  });

  it('returns null on an ambiguous tie', () => {
    expect(matchOption('the team', ['Design team', 'Sales team'])).toBeNull();
  });
});

describe('describeConfirmationForSpeech', () => {
  it('reads the message body back before sending', () => {
    expect(
      describeConfirmationForSpeech('sendWhatsappMessage', {
        contactName: 'Alvin',
        text: 'Friday works for me',
      }),
    ).toBe("I'll send this to Alvin: Friday works for me. Send it?");
  });

  it('falls back gracefully when the contact name is missing', () => {
    expect(describeConfirmationForSpeech('sendWhatsappMessage', {})).toBe(
      "I'll send a message to this contact. Send it?",
    );
  });

  it('describes a draft distinctly from a send', () => {
    expect(
      describeConfirmationForSpeech('draftReply', { contactName: 'Mum', text: 'Calling soon' }),
    ).toBe("I'll save this draft for Mum: Calling soon. Save it?");
  });

  it('names the task it is about to add', () => {
    expect(describeConfirmationForSpeech('createTask', { title: 'Pay the invoice' })).toBe(
      "I'll add a task: Pay the invoice. Add it?",
    );
  });

  it('distinguishes setting from clearing needs-reply', () => {
    expect(describeConfirmationForSpeech('markNeedsReply', { value: true })).toContain('flag');
    expect(describeConfirmationForSpeech('markNeedsReply', { value: false })).toContain('clear');
  });

  it('reads back what it will remember', () => {
    expect(
      describeConfirmationForSpeech('rememberThis', {
        content: 'Alvin prefers short updates',
        scope: 'contact',
        contactName: 'Alvin',
      }),
    ).toBe("I'll remember this about Alvin: Alvin prefers short updates. Save it?");
  });

  it('omits the contact clause for a memory about the user', () => {
    expect(
      describeConfirmationForSpeech('rememberThis', {
        content: 'I run on Tuesdays',
        scope: 'user',
      }),
    ).toBe("I'll remember this: I run on Tuesdays. Save it?");
  });

  it('warns that an auto contact goal sends without asking', () => {
    const spoken = describeConfirmationForSpeech('createContactGoal', {
      contactName: 'Mum',
      title: 'Weekly check-in',
      mode: 'auto',
    });
    expect(spoken).toContain('Weekly check-in');
    expect(spoken).toContain('without asking');
  });

  it('says an approval-mode goal routes through Approvals', () => {
    expect(
      describeConfirmationForSpeech('createContactGoal', {
        contactName: 'Mum',
        title: 'Weekly check-in',
        mode: 'draft',
      }),
    ).toContain('approval');
  });

  it('reads the draft body back before sending it', () => {
    expect(
      describeConfirmationForSpeech('sendDraft', { contactName: 'Alvin', text: 'On my way' }),
    ).toBe("I'll send the draft to Alvin: On my way. Send it?");
  });

  it('names what a deletion will destroy', () => {
    expect(
      describeConfirmationForSpeech('forgetMemory', { content: 'Alvin likes long emails' }),
    ).toContain('Alvin likes long emails');
  });

  it('has a generic prompt for an unknown tool', () => {
    expect(describeConfirmationForSpeech('somethingNew', {})).toBe(
      'I need your go-ahead for that. Should I?',
    );
  });

  it('tolerates missing args entirely', () => {
    expect(describeConfirmationForSpeech('createTask', undefined)).toBe("I'll add a task. Add it?");
  });
});
