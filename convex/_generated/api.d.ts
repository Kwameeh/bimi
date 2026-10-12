/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assistant from "../assistant.js";
import type * as assistantFollowUps from "../assistantFollowUps.js";
import type * as assistantPreferences from "../assistantPreferences.js";
import type * as assistantStream from "../assistantStream.js";
import type * as assistantTools from "../assistantTools.js";
import type * as autoReply from "../autoReply.js";
import type * as bulkDelete from "../bulkDelete.js";
import type * as chatSettings from "../chatSettings.js";
import type * as chatState from "../chatState.js";
import type * as checkins from "../checkins.js";
import type * as classification from "../classification.js";
import type * as contactGoals from "../contactGoals.js";
import type * as contactMemory from "../contactMemory.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as dateContext from "../dateContext.js";
import type * as documents from "../documents.js";
import type * as drafts from "../drafts.js";
import type * as extraction from "../extraction.js";
import type * as followups from "../followups.js";
import type * as goalRules from "../goalRules.js";
import type * as http from "../http.js";
import type * as knowledgeEntries from "../knowledgeEntries.js";
import type * as manualMediaProcessing from "../manualMediaProcessing.js";
import type * as media from "../media.js";
import type * as meetings from "../meetings.js";
import type * as memories from "../memories.js";
import type * as memoryExtraction from "../memoryExtraction.js";
import type * as memoryPrompt from "../memoryPrompt.js";
import type * as mentions from "../mentions.js";
import type * as messageActions from "../messageActions.js";
import type * as messageProcessingPolicy from "../messageProcessingPolicy.js";
import type * as messages from "../messages.js";
import type * as providers_aiSdk from "../providers/aiSdk.js";
import type * as providers_assemblyAi from "../providers/assemblyAi.js";
import type * as providers_cloudflare from "../providers/cloudflare.js";
import type * as providers_config from "../providers/config.js";
import type * as providers_evolution from "../providers/evolution.js";
import type * as providers_language from "../providers/language.js";
import type * as providers_models from "../providers/models.js";
import type * as providers_processing from "../providers/processing.js";
import type * as providers_transcription from "../providers/transcription.js";
import type * as providers_workersAi from "../providers/workersAi.js";
import type * as quietHours from "../quietHours.js";
import type * as reminders from "../reminders.js";
import type * as replies from "../replies.js";
import type * as replyRules from "../replyRules.js";
import type * as replyStyle from "../replyStyle.js";
import type * as search from "../search.js";
import type * as summaries from "../summaries.js";
import type * as tasks from "../tasks.js";
import type * as trends from "../trends.js";
import type * as userPreferences from "../userPreferences.js";
import type * as voice from "../voice.js";
import type * as voiceText from "../voiceText.js";
import type * as whatsappJid from "../whatsappJid.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assistant: typeof assistant;
  assistantFollowUps: typeof assistantFollowUps;
  assistantPreferences: typeof assistantPreferences;
  assistantStream: typeof assistantStream;
  assistantTools: typeof assistantTools;
  autoReply: typeof autoReply;
  bulkDelete: typeof bulkDelete;
  chatSettings: typeof chatSettings;
  chatState: typeof chatState;
  checkins: typeof checkins;
  classification: typeof classification;
  contactGoals: typeof contactGoals;
  contactMemory: typeof contactMemory;
  contacts: typeof contacts;
  crons: typeof crons;
  dateContext: typeof dateContext;
  documents: typeof documents;
  drafts: typeof drafts;
  extraction: typeof extraction;
  followups: typeof followups;
  goalRules: typeof goalRules;
  http: typeof http;
  knowledgeEntries: typeof knowledgeEntries;
  manualMediaProcessing: typeof manualMediaProcessing;
  media: typeof media;
  meetings: typeof meetings;
  memories: typeof memories;
  memoryExtraction: typeof memoryExtraction;
  memoryPrompt: typeof memoryPrompt;
  mentions: typeof mentions;
  messageActions: typeof messageActions;
  messageProcessingPolicy: typeof messageProcessingPolicy;
  messages: typeof messages;
  "providers/aiSdk": typeof providers_aiSdk;
  "providers/assemblyAi": typeof providers_assemblyAi;
  "providers/cloudflare": typeof providers_cloudflare;
  "providers/config": typeof providers_config;
  "providers/evolution": typeof providers_evolution;
  "providers/language": typeof providers_language;
  "providers/models": typeof providers_models;
  "providers/processing": typeof providers_processing;
  "providers/transcription": typeof providers_transcription;
  "providers/workersAi": typeof providers_workersAi;
  quietHours: typeof quietHours;
  reminders: typeof reminders;
  replies: typeof replies;
  replyRules: typeof replyRules;
  replyStyle: typeof replyStyle;
  search: typeof search;
  summaries: typeof summaries;
  tasks: typeof tasks;
  trends: typeof trends;
  userPreferences: typeof userPreferences;
  voice: typeof voice;
  voiceText: typeof voiceText;
  whatsappJid: typeof whatsappJid;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
