# AI providers

Set provider credentials and selection settings on the **Convex backend**. The Expo client receives model metadata through `assistant.listModels`; it never receives keys or endpoint URLs.

## Text and assistant chat

| `BIMI_AI_PROVIDER`  | Credentials                                               | Default model setting                   | Additional picker models                 |
| ------------------- | --------------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `cloudflare`        | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`           | `CLOUDFLARE_WORKERS_AI_ASSISTANT_MODEL` | `CLOUDFLARE_WORKERS_AI_ASSISTANT_MODELS` |
| `openai`            | `OPENAI_API_KEY`                                          | `OPENAI_MODEL`                          | `OPENAI_MODELS`                          |
| `anthropic`         | `ANTHROPIC_API_KEY`                                       | `ANTHROPIC_MODEL`                       | `ANTHROPIC_MODELS`                       |
| `google`            | `GOOGLE_GENERATIVE_AI_API_KEY`                            | `GOOGLE_MODEL`                          | `GOOGLE_MODELS`                          |
| `groq`              | `GROQ_API_KEY`                                            | `GROQ_MODEL`                            | `GROQ_MODELS`                            |
| `deepseek`          | `DEEPSEEK_API_KEY`                                        | `DEEPSEEK_MODEL`                        | `DEEPSEEK_MODELS`                        |
| `openai-compatible` | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL` | `OPENAI_COMPATIBLE_MODEL`               | `OPENAI_COMPATIBLE_MODELS`               |

Additional lists (`*_MODELS`) are comma-separated native model IDs made selectable in the client's assistant model picker. A provider appears in the picker only with valid credentials and at least one model. Assistant models must support native tool calling.

---

## Model resolution hierarchy & background tasks

Bimi categorizes text operations into **5 distinct task purposes**:

| Purpose     | Task in Bimi              | What it executes                                                       |
| :---------- | :------------------------ | :--------------------------------------------------------------------- |
| `assistant` | Assistant Chat Tab        | Interactive chat turns with tool calling and response streaming        |
| `reply`     | WhatsApp Replies & Drafts | Auto-replies and proposed draft suggestions for incoming messages      |
| `summary`   | Summaries & Briefings     | Conversation summaries, group chat digests, and daily briefings        |
| `json`      | Memory Extraction & Goals | Intent classification, entity/memory extraction, contact goal strategy |
| `text`      | General Fallback          | Ad-hoc text operations                                                 |

Whenever a task executes, Bimi determines the model using a **4-tier resolution hierarchy**:

1. **Specific Task Override**:
   - `BIMI_AI_REPLY_MODEL`: Model used for WhatsApp reply drafts
   - `BIMI_AI_SUMMARY_MODEL`: Model used for conversation and group digests
   - `BIMI_AI_JSON_MODEL`: Model used for structured schema/memory extraction & goal evaluation
   - `BIMI_AI_TEXT_MODEL`: Model used for general text tasks
2. **Global Text Override (`BIMI_AI_MODEL`)**:
   - If set, overrides all tasks across the selected provider unless a specific task override above is set.
3. **Provider Default (`<PROVIDER>_MODEL`)**:
   - The primary model configured for that provider (e.g. `DEEPSEEK_MODEL`, `GROQ_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`).
   - **If no task-specific overrides are set, this single model automatically handles all 5 tasks.**
4. **Cloudflare Fallbacks**:
   - Hardcoded Cloudflare model defaults apply _only_ when `BIMI_AI_PROVIDER=cloudflare` and no other settings are given.

---

## Switching providers: single model vs. task specialization

When switching from Cloudflare to DeepSeek, Groq, OpenAI, or Anthropic, you can choose between two approaches:

### Option 1: Simple 1-model setup (recommended to start)

Provide only the provider name, API key, and default model. That model will power the assistant, replies, summaries, and extraction:

```dotenv
BIMI_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-your-deepseek-key
DEEPSEEK_MODEL=deepseek-chat
```

### Option 2: Task-specialized setup (cost & latency optimized)

You can assign lightweight, fast models to high-frequency background operations (summaries, replies) and reserve larger, reasoning-capable models for the assistant and tool calling:

```dotenv
BIMI_AI_PROVIDER=groq
GROQ_API_KEY=gsk-your-groq-key

# Strong 70B model for tool-calling assistant and JSON extraction
GROQ_MODEL=llama-3.3-70b-versatile
BIMI_AI_JSON_MODEL=llama-3.3-70b-versatile

# Ultra-fast 8B model for WhatsApp replies and daily summaries
BIMI_AI_REPLY_MODEL=llama-3.1-8b-instant
BIMI_AI_SUMMARY_MODEL=llama-3.1-8b-instant
```

---

## In-app model picker vs. background tasks

- **Assistant conversations**: Saved threads use `provider/model` (e.g. `deepseek/deepseek-chat`, `anthropic/claude-3-5-sonnet-latest`). Changing a model in the chat thread header affects **only that conversation**.
- **System tasks**: WhatsApp replies, contact goal evaluations, and scheduled summary crons **always** run on the backend-configured environment models.
- **Removed models**: If a model selected in a past conversation is removed from your environment, Bimi surfaces an actionable prompt to choose an available model instead of silently rerouting data.

---

## Example: DeepSeek configuration

DeepSeek operates as a first-class provider via Bimi's OpenAI-compatible adapter:

```dotenv
BIMI_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-your-deepseek-key
DEEPSEEK_MODEL=deepseek-chat

# Optionally expose both DeepSeek V3 and DeepSeek R1 in the conversation picker:
DEEPSEEK_MODELS=deepseek-chat,deepseek-reasoner

# DeepSeek is text-only: pair with a vision provider for image analysis
BIMI_VISION_PROVIDER=cloudflare
```

> [!NOTE]
> `deepseek-chat` (DeepSeek V3) is recommended for assistant chat and contact goals because it supports native function/tool calling. If you select `deepseek-reasoner` (R1) for chat, Bimi's stream engine automatically captures thoughts from `reasoningText`.

---

## Example: multi-provider mix

Set these on Convex, substituting model IDs from the providers' current catalogs:

```dotenv
BIMI_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-private-key
ANTHROPIC_MODEL=claude-3-5-sonnet-latest

# Offload frequent background summaries to Claude Haiku
BIMI_AI_SUMMARY_MODEL=claude-3-5-haiku-latest
BIMI_AI_REPLY_MODEL=claude-3-5-haiku-latest

# Another provider becomes selectable for conversations in the app
DEEPSEEK_API_KEY=your-private-key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_MODELS=deepseek-chat,deepseek-reasoner

# Images use a vision-capable Gemini model
BIMI_VISION_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=your-private-key
BIMI_VISION_MODEL=your-gemini-vision-model-id

# Voice notes and fallback voice input use Whisper on Groq
BIMI_TRANSCRIPTION_PROVIDER=groq
GROQ_API_KEY=your-private-key
BIMI_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
```

Vision-only Google configuration does not need `GOOGLE_MODEL`. Add it to make Google selectable for assistant conversations.

## Images and speech output

`BIMI_VISION_PROVIDER` defaults to `cloudflare`. Other supported values are `openai`, `anthropic`, `google`, `groq`, and `openai-compatible`; configure corresponding credentials and a vision-capable `BIMI_VISION_MODEL`. DeepSeek is not enabled as a vision provider. A text-only model cannot process images.

Cloudflare uses `CLOUDFLARE_WORKERS_AI_VISION_MODEL`. Its optional `CLOUDFLARE_WORKERS_AI_VISION_STRUCTURED_MODEL` enables direct image classification. Other providers describe images first, then use the configured text provider for classification. Changing the text provider alone leaves vision unchanged.

Server speech synthesis currently uses Cloudflare MeloTTS, with a client-side device fallback. `CLOUDFLARE_WORKERS_AI_TTS_MODEL` remains supported.

## Transcription

| `BIMI_TRANSCRIPTION_PROVIDER` | Credentials                                               | Default model                                         |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `assemblyai` (legacy default) | `ASSEMBLYAI_API_KEY`                                      | `ASSEMBLYAI_SPEECH_MODELS`, defaults to `universal-2` |
| `openai`                      | `OPENAI_API_KEY`                                          | `whisper-1`                                           |
| `groq`                        | `GROQ_API_KEY`                                            | `whisper-large-v3-turbo`                              |
| `cloudflare`                  | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`           | `@cf/openai/whisper`                                  |
| `openai-compatible`           | `OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL` | Required `OPENAI_COMPATIBLE_TRANSCRIPTION_MODEL`      |

`BIMI_TRANSCRIPTION_MODEL` overrides models for OpenAI, Groq, Cloudflare, or compatible endpoints. AssemblyAI keeps its comma-separated `ASSEMBLYAI_SPEECH_MODELS` setting. Compatible transcription uses multipart `/audio/transcriptions`; replacements must implement that protocol and JSON `{ "text": "..." }` output. Cloudflare Whisper uses binary input; replacement models must accept that format.

Uploads preserve supplied MIME types or infer common formats from audio headers. Unknown formats are rejected. OpenAI-compatible and Cloudflare adapters enforce a 25 MB input limit and 120-second request timeout; provider-specific limits may be lower. Empty transcripts are valid. There is no automatic cross-provider fallback.

The same adapter serves automatic voice-note processing, manual media processing, and fallback voice input. Transcription selection applies deployment-wide; conversation selection applies to text assistant chat.

OpenAI's documented upload formats exclude OGG and FLAC. WhatsApp voice notes commonly arrive as OGG; use Groq Whisper, Cloudflare Whisper, or AssemblyAI for those recordings, or convert them before using OpenAI. This adapter rejects unsupported OpenAI containers before uploading rather than relabeling the bytes. Native M4A and web WebM recordings can use OpenAI directly.

## Extend the adapters

- `config.ts` owns metadata, configuration, catalogs, and selection.
- `language.ts` constructs AI SDK models. Register new provider metadata in `config.ts` and its SDK here.
- `aiSdk.ts` owns streaming, tool calls, and schema extraction.
- `processing.ts` owns task prompts and routes text/image processing.
- `cloudflare.ts` isolates Cloudflare vision and speech synthesis protocols.
- `transcription.ts` defines `TranscriptionAdapter` and its registry. Add adapters with their validated provider IDs and documentation.

These files live under `convex/providers/`. `workersAi.ts` is a compatibility export. Feature code should import `processing.ts`, `aiSdk.ts`, or `transcription.ts`.

Test request/response protocols with mocks and validate real-account capabilities separately. Text, streaming, tool calling, vision, reasoning, and JSON schema support vary by model.

## Provider references

- [AI SDK providers](https://ai-sdk.dev/providers)
- [Groq compatibility](https://console.groq.com/docs/openai) and [speech to text](https://console.groq.com/docs/speech-to-text)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [OpenAI transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Cloudflare Whisper](https://developers.cloudflare.com/workers-ai/models/whisper/)
