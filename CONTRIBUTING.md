# Contributing to Bimi

Thank you for your interest in contributing to Bimi! We welcome bug fixes, documentation improvements, architectural proposals, and new capabilities.

Please take a moment to review this guide and our [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

---

## Development Principles & Quality Standards

To maintain engineering rigor across mobile client and backend systems:

1. **Zero Warnings Policy**: We enforce zero TypeScript errors (`tsc --noEmit`) and zero ESLint warnings (`expo lint`) across all screens, components, and backend functions.
2. **Behavioral Testing**: Every feature change, provider integration, and state transition should include unit and behavioral tests.
3. **No Slop / Clean Architecture**: Code should be intentionally structured, idiomatic React 19 / Expo SDK 56, and adhere strictly to Convex reactive patterns.
4. **Security & Privacy First**: Never commit private message content, audio, phone numbers, or API keys in tests or documentation. Use synthetic fixtures. API keys and model credentials belong exclusively on the Convex backend—never expose secrets via `EXPO_PUBLIC_` client environment variables.

---

## Local Setup

1. **Clone & Install**:

   ```sh
   git clone https://github.com/Kwameeh/bimi.git
   cd bimi
   bun install
   ```

2. **Backend Setup**:
   Start your local or cloud Convex deployment:

   ```sh
   bunx convex dev
   ```

3. **Start the Mobile Client**:
   ```sh
   bun run start
   ```

---

## Verification Pipeline

Before opening a pull request, ensure all checks pass cleanly:

```sh
# Verify code formatting
bun run format:check

# Verify TypeScript types
bun run typecheck

# Verify linter rules (0 errors, 0 warnings)
bun run lint

# Run the complete test suite
bun run test
```

You can automatically format code using:

```sh
bun run format
```

---

## Architecture & Code Guidelines

- **Expo / React Native**: Follow Expo SDK 56 APIs and guidelines.
- **Convex Backend**: Always consult `convex/_generated/ai/guidelines.md` before making modifications to queries, mutations, or internal actions. Never use in-memory table scans where indexed queries belong.
- **AI Providers**: Implement provider adapters via [convex/providers/](convex/providers/) rather than making ad-hoc HTTP calls in feature code. Read [docs/ai-providers.md](docs/ai-providers.md) for details on the multi-provider routing design.
- **Voice & Realtime**: Spoken intent parsers and audio processing pipelines reside in [convex/voiceText.ts](convex/voiceText.ts) and [src/lib/speech/](src/lib/speech/).

---

## Pull Request Guidelines

1. **Focus**: Keep PRs focused on a single logical change or bug fix.
2. **Description**: Use the provided [PR template](.github/pull_request_template.md). Explain the problem, the solution, and verification steps. Include screenshots or screen recordings for UI changes.
3. **Tests**: Ensure tests are added or updated to cover the new behavior.

---

## Licensing

By contributing to Bimi, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
