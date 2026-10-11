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

Additional lists are comma-separated native model IDs. A provider appears only with credentials, required endpoint settings, and at least one model. Cloudflare retains the existing curated list. Other providers require explicit models, so deployments can select models available to their accounts. Assistant models must support native tool calling.

`BIMI_AI_MODEL` overrides the default for the selected provider. Optional `BIMI_AI_TEXT_MODEL`, `BIMI_AI_JSON_MODEL`, `BIMI_AI_REPLY_MODEL`, and `BIMI_AI_SUMMARY_MODEL` override background tasks on that same provider. These values are native model IDs, without a Bimi provider prefix.

Saved conversation selections use `provider/model`, such as `openai/your-model-id`; Cloudflare IDs retain their existing format. Changing the deployment default affects conversations without an explicit selection and background tasks. Explicit selections stay on their chosen provider. Removed providers/models produce an actionable error rather than automatically sending data elsewhere.

Without new settings, existing Cloudflare assistant, chat, summary, and JSON-extraction defaults apply. `CLOUDFLARE_WORKERS_AI_CHAT_MODEL` and `CLOUDFLARE_WORKERS_AI_SUMMARY_MODEL` remain supported.

Compatible endpoint base URLs must include the service's API prefix, such as `http://localhost:8000/v1`. The URL must be reachable **from Convex**; localhost only works with the appropriate backend/model-server network. Supply a placeholder key for endpoints that need no authentication. Set `OPENAI_COMPATIBLE_STRUCTURED_OUTPUTS=true` only if JSON schema output is implemented. Schema extraction falls back to a JSON prompt when structured output fails; feature parsers validate results.

## Example: mix providers

Set these on Convex, substituting model IDs from the providers' current catalogs:

```dotenv
BIMI_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-private-key
ANTHROPIC_MODEL=your-claude-model-id

# Another provider becomes selectable for conversations.
DEEPSEEK_API_KEY=your-private-key
DEEPSEEK_MODEL=your-deepseek-model-id

# Images use a vision-capable Gemini model.
BIMI_VISION_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=your-private-key
BIMI_VISION_MODEL=your-gemini-vision-model-id

# Voice notes and fallback voice input use Whisper on Groq.
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
