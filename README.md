# Bimi

Your smart chat buddy. Bimi is a personal WhatsApp assistant built with Expo and Convex. It brings chats, draft replies, summaries, tasks, meetings, contact memory, and voice interaction into one app.

**Deployment scope:** Bimi currently targets a trusted, single-user backend. Authentication and ownership checks across the public API are still needed before offering a public multi-user service. Read [SECURITY.md](SECURITY.md) before connecting real conversations.

## Features

- Receive and send WhatsApp messages through Evolution API.
- Ask about conversations, search messages, and prepare actions with approval cards.
- Generate draft replies, summaries, tasks, follow-ups, and contact memory.
- Describe images, summarize documents, and transcribe voice notes.
- Select different providers for assistant chat, vision, and transcription.

## Run locally

You need Node.js 22.13 or newer, Bun 1.3.14, a Convex deployment, and an Evolution API instance for WhatsApp integration. AI features require your own provider credentials. The repository currently uses Expo SDK 56; exact dependencies are in `package.json` and `bun.lock`.

```sh
bun install --frozen-lockfile
```

Copy `.env.example` to `.env.local`. On PowerShell:

```powershell
Copy-Item .env.example .env.local
```

On macOS or Linux:

```sh
cp .env.example .env.local
```

Create or connect your own backend:

```sh
npx convex dev
```

Use its client URL for `EXPO_PUBLIC_CONVEX_URL` and its HTTP actions URL for `EXPO_PUBLIC_CONVEX_SITE_URL`. Set `EXPO_PUBLIC_BIMI_INSTANCE` to your Evolution instance name. Keep `convex dev` running during development.

Set backend credentials in the Convex dashboard or with `npx convex env set NAME VALUE`. `.env.server.example` lists supported settings; it is a reference file and is not loaded automatically. API keys and administrative credentials must stay on the backend.

Configure Evolution's webhook URL as `https://YOUR_CONVEX_HTTP_HOST/webhooks/evolution`. Set `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, and a strong `EVOLUTION_WEBHOOK_SECRET` on the backend. Supply the matching secret with the `x-bimi-webhook-secret` header; the endpoint also accepts a `secret` query parameter. Enable message and contact events in your Evolution deployment.

Start the client in another terminal:

```sh
bun run start
```

Use a development build for native integrations:

```sh
bun run android
# macOS with Xcode:
bun run ios
# Web:
bun run web
```

Microphone, contacts, calendars, and notifications have platform-specific permissions and support. Voice input prefers on-device recognition and uses backend transcription as a fallback.

## AI providers

Text AI supports **Cloudflare Workers AI, OpenAI, Anthropic, Google Gemini, Groq, DeepSeek**, and **OpenAI-compatible endpoints**. Configure a provider's key and model on Convex, then select it from the conversation's model picker. Only configured providers appear.

`BIMI_AI_PROVIDER` chooses the deployment default for new conversations and background processing. Vision and transcription are independent. Existing deployments default to Cloudflare for text/vision and AssemblyAI for transcription.

Transcription supports AssemblyAI, OpenAI Whisper, Groq Whisper, Cloudflare Whisper, and compatible audio endpoints. See [AI provider configuration and extension](docs/ai-providers.md) for settings and examples.

## Builds and checks

EAS profiles use the `development`, `preview`, and `production` environments. Set your own client URLs and instance name in each EAS environment. Run `eas init` for your own project or set `BIMI_EXPO_OWNER` and `BIMI_EAS_PROJECT_ID`. Optional `BIMI_ANDROID_PACKAGE` and `BIMI_IOS_BUNDLE_IDENTIFIER` customize application identifiers. The committed configuration contains no maintainer account, project ID, LAN address, or production backend URLs.

```sh
bun run typecheck
bun run test
bun run lint
```

Provider contract tests use mocked responses; real provider availability, billing, capabilities, and native device behavior require your own configured deployment.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md), and [SECURITY.md](SECURITY.md). Use synthetic data in issues and fixtures. Authentication, deployment onboarding, and device testing are useful areas for contributions.

Bimi is licensed under the [Apache License 2.0](LICENSE).
