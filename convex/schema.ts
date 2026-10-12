import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const priorityValidator = v.union(
  v.literal('urgent'),
  v.literal('high'),
  v.literal('normal'),
  v.literal('low'),
);

const aiModeValidator = v.union(
  v.literal('manual'),
  v.literal('semi_auto'),
  v.literal('full_auto'),
  v.literal('silent'),
);

const incomingMessageModeValidator = v.union(
  v.literal('save_and_process'),
  v.literal('save_only'),
  v.literal('ignore'),
);

const messageProcessingModeValidator = v.union(v.literal('automatic'), v.literal('manual_only'));

const messageCategoryValidator = v.union(
  v.literal('greeting'),
  v.literal('meeting'),
  v.literal('deadline'),
  v.literal('payment'),
  v.literal('client_issue'),
  v.literal('project_update'),
  v.literal('school'),
  v.literal('family'),
  v.literal('document'),
  v.literal('image'),
  v.literal('voice'),
  v.literal('group_announcement'),
  v.literal('spam'),
  v.literal('unknown'),
);

const toneValidator = v.union(
  v.literal('casual'),
  v.literal('professional'),
  v.literal('friendly'),
  v.literal('concise'),
  v.literal('custom'),
);

export const reactionValidator = v.object({
  emoji: v.string(),
  fromMe: v.boolean(),
  participant: v.optional(v.string()),
  pushName: v.optional(v.string()),
  timestamp: v.optional(v.number()),
});

export default defineSchema({
  contacts: defineTable({
    instance: v.string(),
    remoteJid: v.string(),
    phoneNumber: v.optional(v.string()),
    normalizedPhone: v.optional(v.string()),
    displayName: v.optional(v.string()),
    pushName: v.optional(v.string()),
    deviceContactId: v.optional(v.string()),
    deviceContactName: v.optional(v.string()),
    source: v.optional(v.union(v.literal('whatsapp'), v.literal('device'), v.literal('bimi'))),
    syncStatus: v.optional(
      v.union(
        v.literal('synced'),
        v.literal('pending_phone_create'),
        v.literal('pending_cloud_import'),
        v.literal('failed'),
      ),
    ),
    syncError: v.optional(v.string()),
    lastDeviceSeenAt: v.optional(v.number()),
    lastDeviceSyncedAt: v.optional(v.number()),
    syncUpdatedAt: v.optional(v.number()),
    lastMessageAt: v.optional(v.number()),
    lastReadAt: v.optional(v.number()),
    isGroup: v.optional(v.boolean()),
    groupSubject: v.optional(v.string()),
    groupDescription: v.optional(v.string()),
    groupSize: v.optional(v.number()),
    groupOwner: v.optional(v.string()),
    groupPictureUrl: v.optional(v.string()),
    groupCreationAt: v.optional(v.number()),
    groupParticipants: v.optional(
      v.array(
        v.object({
          id: v.string(),
          admin: v.optional(v.string()),
        }),
      ),
    ),
    groupInfoUpdatedAt: v.optional(v.number()),
    priority: v.optional(priorityValidator),
    muted: v.optional(v.boolean()),
    aiMode: v.optional(aiModeValidator),
    incomingMessageMode: v.optional(incomingMessageModeValidator),
    // Timestamp of the newest message that automatic AI may consume. Unlike
    // lastMessageAt, save-only messages do not advance this checkpoint.
    lastAutomaticMessageAt: v.optional(v.number()),
    autoReplyAllowGreetings: v.optional(v.boolean()),
    autoReplyAllowAcknowledgments: v.optional(v.boolean()),
    autoReplyAllowSmallTalk: v.optional(v.boolean()),
    autoReplyBlocked: v.optional(v.boolean()),
    lastAutoReplyAt: v.optional(v.number()),
    relationship: v.optional(
      v.union(
        v.literal('vip'),
        v.literal('client'),
        v.literal('family'),
        v.literal('friend'),
        v.literal('classmate'),
        v.literal('team'),
        v.literal('low_priority'),
        v.literal('unknown'),
      ),
    ),
    checkInCadenceDays: v.optional(v.number()),
    checkInWeekday: v.optional(v.number()),
    lastUserMessageAt: v.optional(v.number()),
    lastCheckInAt: v.optional(v.number()),
    memoryEnabled: v.optional(v.boolean()),
    // Cached WhatsApp profile picture. The URL is served straight from
    // pps.whatsapp.net rather than copied into Convex storage, and those URLs are
    // signed and rotate — so avatarCheckedAt drives a periodic liveness check
    // that re-fetches from Evolution once a URL stops resolving.
    avatarUrl: v.optional(v.string()),
    avatarCheckedAt: v.optional(v.number()),
    avatarStatus: v.optional(
      v.union(
        v.literal('ready'),
        // No picture, or hidden by the contact's privacy settings.
        v.literal('none'),
        v.literal('failed'),
      ),
    ),
    // Denormalized chat-list row, maintained on write by convex/chatState.ts so
    // contacts.listChats never has to scan messages or drafts. Absent (or an
    // older chatStateVersion) means "not backfilled yet" and the query falls
    // back to computing the row from source.
    chatStateVersion: v.optional(v.number()),
    unreadCount: v.optional(v.number()),
    unreadUrgent: v.optional(v.boolean()),
    unreadNeedsReply: v.optional(v.boolean()),
    unreadDeadline: v.optional(v.boolean()),
    unreadMeeting: v.optional(v.boolean()),
    unreadMentioned: v.optional(v.boolean()),
    pendingDraftCount: v.optional(v.number()),
    lastMessagePreview: v.optional(
      v.object({
        messageId: v.id('messages'),
        text: v.string(),
        fromMe: v.boolean(),
        sentByAi: v.boolean(),
        timestamp: v.optional(v.number()),
        messageType: v.string(),
        deliveryStatus: v.optional(
          v.union(
            v.literal('pending'),
            v.literal('sent'),
            v.literal('delivered'),
            v.literal('read'),
            v.literal('played'),
            v.literal('error'),
          ),
        ),
        participant: v.optional(v.string()),
        participantPushName: v.optional(v.string()),
      }),
    ),
  })
    .index('by_instance', ['instance'])
    .index('by_instance_and_remoteJid', ['instance', 'remoteJid'])
    .index('by_instance_and_normalizedPhone', ['instance', 'normalizedPhone'])
    .index('by_instance_and_deviceContactId', ['instance', 'deviceContactId'])
    .index('by_instance_and_syncStatus', ['instance', 'syncStatus'])
    .index('by_instance_and_lastMessageAt', ['instance', 'lastMessageAt'])
    .searchIndex('search_name', {
      searchField: 'displayName',
      filterFields: ['instance'],
    }),

  messages: defineTable({
    contactId: v.id('contacts'),
    instance: v.string(),
    remoteJid: v.string(),
    messageId: v.string(),
    fromMe: v.boolean(),
    messageType: v.string(),
    text: v.string(),
    caption: v.optional(v.string()),
    pushName: v.optional(v.string()),
    timestamp: v.optional(v.number()),
    status: v.union(
      v.literal('ready'),
      v.literal('processing'),
      v.literal('failed'),
      v.literal('skipped'),
    ),
    // Immutable receipt-time policy. Missing legacy values are treated as
    // automatic so existing history keeps its current behavior.
    processingModeAtIngest: v.optional(messageProcessingModeValidator),
    mediaMimeType: v.optional(v.string()),
    mediaFileName: v.optional(v.string()),
    mediaSeconds: v.optional(v.number()),
    mediaPageCount: v.optional(v.number()),
    mediaFileLength: v.optional(v.number()),
    processingError: v.optional(v.string()),
    sentByAi: v.optional(v.boolean()),
    participant: v.optional(v.string()),
    participantPushName: v.optional(v.string()),
    deliveryStatus: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('sent'),
        v.literal('delivered'),
        v.literal('read'),
        v.literal('played'),
        v.literal('error'),
      ),
    ),
    mediaStorageId: v.optional(v.id('_storage')),
    mediaFetchStatus: v.optional(
      v.union(v.literal('pending'), v.literal('ready'), v.literal('failed')),
    ),
    isImportant: v.optional(v.boolean()),
    isUrgent: v.optional(v.boolean()),
    needsReply: v.optional(v.boolean()),
    hasDeadline: v.optional(v.boolean()),
    isMeeting: v.optional(v.boolean()),
    autoReplied: v.optional(v.boolean()),
    aiSummary: v.optional(v.string()),
    aiExplanation: v.optional(v.string()),
    category: v.optional(messageCategoryValidator),
    priority: v.optional(priorityValidator),
    classifiedAt: v.optional(v.number()),
    classificationConfidence: v.optional(v.number()),
    mentionedJids: v.optional(v.array(v.string())),
    quotedMessageId: v.optional(v.string()),
    quotedParticipant: v.optional(v.string()),
    mentionsUser: v.optional(v.boolean()),
    mentionReason: v.optional(v.string()),
    isNoise: v.optional(v.boolean()),
    imageType: v.optional(
      v.union(
        v.literal('payment'),
        v.literal('receipt'),
        v.literal('flyer'),
        v.literal('server_error'),
        v.literal('notice'),
        v.literal('screenshot_text'),
        v.literal('other'),
      ),
    ),
    extractedFields: v.optional(v.any()),
    reactions: v.optional(v.array(reactionValidator)),
  })
    .index('by_instance_and_messageId', ['instance', 'messageId'])
    .index('by_contact', ['contactId'])
    .index('by_contact_and_timestamp', ['contactId', 'timestamp'])
    .index('by_contactId_and_processingModeAtIngest_and_timestamp', [
      'contactId',
      'processingModeAtIngest',
      'timestamp',
    ])
    .index('by_contact_and_needsReply', ['contactId', 'needsReply'])
    .index('by_contact_and_isUrgent', ['contactId', 'isUrgent'])
    .index('by_contact_and_category', ['contactId', 'category'])
    .index('by_contact_and_mentionsUser', ['contactId', 'mentionsUser'])
    .index('by_instance_and_timestamp', ['instance', 'timestamp'])
    .index('by_instance_and_processingModeAtIngest_and_timestamp', [
      'instance',
      'processingModeAtIngest',
      'timestamp',
    ])
    .searchIndex('search_text', {
      searchField: 'text',
      filterFields: ['contactId', 'instance', 'fromMe'],
    }),

  drafts: defineTable({
    instance: v.string(),
    contactId: v.id('contacts'),
    sourceMessageId: v.optional(v.id('messages')),
    text: v.string(),
    /** Initial/generated text retained when the user edits the draft. */
    generatedText: v.optional(v.string()),
    userEditedAt: v.optional(v.number()),
    feedbackVariant: v.optional(v.string()),
    approvedByUser: v.optional(v.boolean()),
    style: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('sent'), v.literal('rejected')),
    sentMessageId: v.optional(v.id('messages')),
    reason: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    confidence: v.optional(v.number()),
    aiSummary: v.optional(v.string()),
    category: v.optional(messageCategoryValidator),
    sourceMode: v.optional(v.union(v.literal('auto_pipeline'), v.literal('manual_request'))),
    // Set when a contact goal produced this draft, so the goal can find and
    // regenerate its own pending draft instead of stacking new ones, and so
    // approving it credits the goal's reply-detection signal.
    goalId: v.optional(v.id('contactGoals')),
  })
    .index('by_contact_and_status', ['contactId', 'status'])
    .index('by_instance_and_status', ['instance', 'status'])
    .index('by_sourceMessage', ['sourceMessageId']),

  tasks: defineTable({
    instance: v.string(),
    contactId: v.optional(v.id('contacts')),
    sourceMessageId: v.optional(v.id('messages')),
    title: v.string(),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    priority: v.optional(priorityValidator),
    status: v.union(v.literal('open'), v.literal('done')),
    completedAt: v.optional(v.number()),
    createdBy: v.union(v.literal('user'), v.literal('ai')),
    mentionCount: v.optional(v.number()),
    sourceContactIds: v.optional(v.array(v.id('contacts'))),
    sourceMessageIds: v.optional(v.array(v.id('messages'))),
    lastMentionedAt: v.optional(v.number()),
  })
    .index('by_instance_and_status', ['instance', 'status'])
    .index('by_contact', ['contactId'])
    .index('by_dueAt', ['dueAt']),

  userPreferences: defineTable({
    instance: v.string(),
    defaultTone: toneValidator,
    customTone: v.optional(v.string()),
    replyStyleLearningEnabled: v.optional(v.boolean()),
    defaultAiMode: v.optional(aiModeValidator),
    ownerJid: v.optional(v.string()),
    ownerPhone: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    ownerAliases: v.optional(v.array(v.string())),
    pushToken: v.optional(v.string()),
    lastOpenedAt: v.optional(v.number()),
    autoExtractTasks: v.optional(v.boolean()),
    quietHoursEnabled: v.optional(v.boolean()),
    quietHoursStart: v.optional(v.string()),
    quietHoursEnd: v.optional(v.string()),
    quietHoursTimezone: v.optional(v.string()),
    quietHoursAllowVip: v.optional(v.boolean()),
    memoryWriteMode: v.optional(
      v.union(v.literal('auto'), v.literal('approval'), v.literal('off')),
    ),
    memoryExtractionIntervalHours: v.optional(v.number()),
    memoryExtractionDailyTime: v.optional(v.string()),
    memoryExtractionTimezone: v.optional(v.string()),
    voiceMode: v.optional(v.union(v.literal('push_to_talk'), v.literal('conversational'))),
    voiceTtsEngine: v.optional(v.union(v.literal('device'), v.literal('bimi'))),
    voiceAutoSpeak: v.optional(v.boolean()),
    voiceLocale: v.optional(v.string()),
  }).index('by_instance', ['instance']),

  knowledgeEntries: defineTable({
    instance: v.string(),
    kind: v.union(
      v.literal('project'),
      v.literal('url'),
      v.literal('template'),
      v.literal('client_note'),
      v.literal('availability'),
      v.literal('note'),
    ),
    title: v.string(),
    body: v.string(),
    tags: v.optional(v.array(v.string())),
    pinned: v.optional(v.boolean()),
    contactId: v.optional(v.id('contacts')),
    updatedAt: v.number(),
  })
    .index('by_instance_and_kind', ['instance', 'kind'])
    .index('by_instance_and_pinned', ['instance', 'pinned'])
    .searchIndex('search_body', {
      searchField: 'body',
      filterFields: ['instance', 'kind'],
    }),

  dailySummaries: defineTable({
    instance: v.string(),
    date: v.string(),
    generatedAt: v.number(),
    urgent: v.array(
      v.object({
        messageId: v.id('messages'),
        contactId: v.id('contacts'),
        contactName: v.optional(v.string()),
        preview: v.string(),
      }),
    ),
    needsReply: v.array(
      v.object({
        messageId: v.id('messages'),
        contactId: v.id('contacts'),
        contactName: v.optional(v.string()),
        preview: v.string(),
      }),
    ),
    tasks: v.array(
      v.object({
        taskId: v.id('tasks'),
        title: v.string(),
        dueAt: v.optional(v.number()),
      }),
    ),
    meetings: v.array(
      v.object({
        messageId: v.id('messages'),
        contactId: v.id('contacts'),
        contactName: v.optional(v.string()),
        preview: v.string(),
      }),
    ),
    documents: v.array(
      v.object({
        messageId: v.id('messages'),
        contactId: v.id('contacts'),
        contactName: v.optional(v.string()),
        fileName: v.optional(v.string()),
      }),
    ),
    autoReplied: v.array(
      v.object({
        messageId: v.id('messages'),
        contactId: v.id('contacts'),
        contactName: v.optional(v.string()),
        preview: v.string(),
      }),
    ),
    fyi: v.array(
      v.object({
        messageId: v.id('messages'),
        contactId: v.id('contacts'),
        contactName: v.optional(v.string()),
        preview: v.string(),
        category: v.optional(messageCategoryValidator),
      }),
    ),
    pushSent: v.optional(v.boolean()),
    trends: v.optional(
      v.array(
        v.object({
          label: v.string(),
          kind: v.union(v.literal('aggregation'), v.literal('llm')),
          count: v.optional(v.number()),
          contactIds: v.array(v.id('contacts')),
          messageIds: v.array(v.id('messages')),
        }),
      ),
    ),
    actionPlan: v.optional(
      v.array(
        v.object({
          order: v.number(),
          action: v.string(),
          reason: v.optional(v.string()),
          priority: v.union(v.literal('urgent'), v.literal('high'), v.literal('normal')),
          contactId: v.optional(v.id('contacts')),
          contactName: v.optional(v.string()),
          sourceMessageId: v.optional(v.id('messages')),
          taskId: v.optional(v.id('tasks')),
          meetingId: v.optional(v.id('meetings')),
          doneAt: v.optional(v.number()),
        }),
      ),
    ),
  }).index('by_instance_and_date', ['instance', 'date']),

  reminders: defineTable({
    instance: v.string(),
    contactId: v.optional(v.id('contacts')),
    sourceMessageId: v.optional(v.id('messages')),
    text: v.string(),
    remindAt: v.number(),
    status: v.union(
      v.literal('suggested'),
      v.literal('pending'),
      v.literal('fired'),
      v.literal('dismissed'),
    ),
    kind: v.optional(v.union(v.literal('user'), v.literal('ai_followup'))),
  })
    .index('by_instance_and_status', ['instance', 'status'])
    .index('by_contact', ['contactId'])
    .index('by_contact_and_status', ['contactId', 'status'])
    .index('by_remindAt', ['remindAt'])
    .index('by_sourceMessage', ['sourceMessageId']),

  assistantThreads: defineTable({
    instance: v.string(),
    title: v.optional(v.string()),
    lastMessageAt: v.number(),
    kind: v.optional(v.union(v.literal('chat'), v.literal('search'))),
    modelId: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
    // Set while the thread is driven by voice mode, so every entry point
    // (send, regenerate, confirm, choose) keeps the spoken answer style.
    voice: v.optional(v.boolean()),
  })
    .index('by_instance_and_lastMessageAt', ['instance', 'lastMessageAt'])
    .index('by_instance_and_kind', ['instance', 'kind'])
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['instance'],
    }),

  assistantMessages: defineTable({
    threadId: v.id('assistantThreads'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('tool')),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolArgs: v.optional(v.any()),
    toolResult: v.optional(v.any()),
    toolCallId: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal('running'),
        v.literal('done'),
        v.literal('error'),
        v.literal('awaiting_confirmation'),
        v.literal('awaiting_choice'),
        v.literal('awaiting_questions'),
        v.literal('cancelled'),
      ),
    ),
    citedMessageIds: v.optional(v.array(v.id('messages'))),
    citedContactIds: v.optional(v.array(v.id('contacts'))),
    cancelRequested: v.optional(v.boolean()),
    suggestedFollowUps: v.optional(v.array(v.string())),
    reasoning: v.optional(v.string()),
  }).index('by_thread', ['threadId']),

  replyStyleProfiles: defineTable({
    instance: v.string(),
    scope: v.union(v.literal('global'), v.literal('contact')),
    contactId: v.optional(v.id('contacts')),
    summary: v.string(),
    targetWords: v.number(),
    maxChars: v.number(),
    emojiRate: v.number(),
    commonEmojis: v.array(v.string()),
    examples: v.array(v.string()),
    contactExamples: v.array(v.string()),
    sampleCount: v.number(),
    lastAnalyzedMessageAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_instance_and_scope', ['instance', 'scope'])
    .index('by_contactId', ['contactId']),

  assistantPreferences: defineTable({
    instance: v.string(),
    preferences: v.string(),
    updatedAt: v.number(),
  }).index('by_instance', ['instance']),

  memories: defineTable({
    instance: v.string(),
    scope: v.union(v.literal('user'), v.literal('contact'), v.literal('chat')),
    contactId: v.optional(v.id('contacts')),
    type: v.union(
      v.literal('fact'),
      v.literal('preference'),
      v.literal('commitment'),
      v.literal('ongoing'),
      v.literal('relationship'),
    ),
    content: v.string(),
    confidence: v.number(),
    status: v.union(
      v.literal('active'),
      v.literal('proposed'),
      v.literal('superseded'),
      v.literal('dismissed'),
      v.literal('expired'),
    ),
    pinned: v.optional(v.boolean()),
    sourceMessageId: v.optional(v.id('messages')),
    createdBy: v.union(v.literal('ai'), v.literal('user')),
    expiresAt: v.optional(v.number()),
    supersededBy: v.optional(v.id('memories')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_instance_scope_status', ['instance', 'scope', 'status'])
    .index('by_contact_scope_status', ['contactId', 'scope', 'status'])
    .index('by_status_expiry', ['status', 'expiresAt'])
    .searchIndex('search_content', {
      searchField: 'content',
      filterFields: ['instance', 'scope', 'status', 'contactId'],
    }),

  memoryAudit: defineTable({
    instance: v.string(),
    memoryId: v.id('memories'),
    action: v.union(
      v.literal('create'),
      v.literal('approve'),
      v.literal('reject'),
      v.literal('edit'),
      v.literal('supersede'),
      v.literal('dismiss'),
      v.literal('delete'),
      v.literal('expire'),
      v.literal('pin'),
      v.literal('unpin'),
    ),
    actor: v.union(v.literal('ai'), v.literal('user'), v.literal('system')),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    at: v.number(),
  }).index('by_memory', ['memoryId']),

  contactMemoryProfiles: defineTable({
    instance: v.string(),
    contactId: v.id('contacts'),
    summary: v.string(),
    relationshipNotes: v.optional(v.string()),
    preferences: v.array(v.string()),
    currentTopics: v.array(v.string()),
    commitments: v.array(v.string()),
    lastProcessedMessageAt: v.optional(v.number()),
    lastProcessedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_contact', ['contactId'])
    .index('by_instance_and_updatedAt', ['instance', 'updatedAt']),

  contactGoals: defineTable({
    instance: v.string(),
    contactId: v.id('contacts'),
    title: v.string(),
    instructions: v.string(),
    kind: v.union(
      v.literal('check_in'),
      v.literal('meeting'),
      v.literal('relationship'),
      v.literal('custom'),
    ),
    recurrence: v.union(
      v.literal('once'),
      v.literal('daily'),
      v.literal('weekly'),
      v.literal('interval'),
      // Open-ended: no clock, keeps working the conversation until the success
      // criteria are met. nextRunAt acts only as a silence timer.
      v.literal('until_done'),
    ),
    intervalHours: v.optional(v.number()),
    preferredTime: v.optional(v.string()),
    timezone: v.optional(v.string()),
    successCriteria: v.optional(v.string()),
    mode: v.union(v.literal('draft'), v.literal('auto')),
    status: v.union(v.literal('active'), v.literal('paused'), v.literal('done')),
    nextRunAt: v.number(),
    lastRunAt: v.optional(v.number()),
    lastDraftId: v.optional(v.id('drafts')),
    // Stall tracking. Counts outbound *attempts* (send or draft) since the
    // contact last replied; at STALL_CAP the goal pauses itself.
    unansweredCount: v.optional(v.number()),
    // Hard lifetime budget. Unlike unansweredCount, turnsUsed only ever grows:
    // it counts every message this goal put in front of someone (sent or
    // drafted) for its whole life.
    turnsUsed: v.optional(v.number()),
    // Wall-clock deadline for an open-ended goal, set at creation. A goal that
    // has not been met in two weeks is not going to be met by nagging.
    expiresAt: v.optional(v.number()),
    lastGoalMessageAt: v.optional(v.number()),
    lastGoalMessageId: v.optional(v.id('messages')),
    lastContactReplyAt: v.optional(v.number()),
    pausedReason: v.optional(v.string()),
    lastStrategyAction: v.optional(v.string()),
    lastStrategyReason: v.optional(v.string()),
    strategyDeferredUntil: v.optional(v.number()),
    // Turn lease. Prevents the hourly cron and the inbound takeover from both
    // emitting for the same goal; turnLockToken fences stale writers.
    turnLockUntil: v.optional(v.number()),
    turnLockToken: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_contact_and_status', ['contactId', 'status'])
    .index('by_status_and_nextRunAt', ['status', 'nextRunAt'])
    .index('by_instance_status_nextRunAt', ['instance', 'status', 'nextRunAt']),

  meetings: defineTable({
    instance: v.string(),
    contactId: v.id('contacts'),
    sourceMessageId: v.id('messages'),
    title: v.optional(v.string()),
    proposedTimes: v.array(
      v.object({
        startAt: v.number(),
        label: v.optional(v.string()),
        durationMinutes: v.optional(v.number()),
      }),
    ),
    selectedStartAt: v.optional(v.number()),
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('declined'),
      v.literal('rescheduled'),
    ),
    confirmationDraftId: v.optional(v.id('drafts')),
    calendarEventId: v.optional(v.string()),
    addedToCalendarAt: v.optional(v.number()),
  })
    .index('by_instance_and_status', ['instance', 'status'])
    .index('by_source', ['sourceMessageId'])
    .index('by_contact_and_status', ['contactId', 'status']),
});
