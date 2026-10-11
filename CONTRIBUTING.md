# Contributing to Bimi

Start with the [README](README.md) and configure your own backend. Use synthetic conversations and media when developing or filing issues.

Keep pull requests focused on a concrete problem. Describe the resulting behavior, relevant screenshots for UI changes, and how you verified the change. Discuss broad architectural changes in an issue first.

Before submitting, run:

```sh
bun run typecheck
bun run test
bun run lint
```

Backend tests use Vitest and `convex-test`. Add behavioral tests for changes to provider routing, processing policies, approval flows, and data handling. Read `convex/_generated/ai/guidelines.md` before editing Convex code. `AGENTS.md` also describes the required Expo documentation workflow; check the installed SDK in `package.json` for version-specific APIs.

Use the provider adapters described in [AI providers](docs/ai-providers.md) rather than making vendor API calls from feature code. Credentials belong on the backend; never use `EXPO_PUBLIC_` for secrets. Avoid recording private message content, audio, contact details, or API credentials in fixtures and screenshots.

The existing screens still have React Compiler migration diagnostics. Those rules are warnings; hook correctness and other lint errors remain enforced. Avoid adding new warnings in changed code.

Contributions are licensed under the project's Apache License 2.0.
