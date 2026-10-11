# Security and deployment scope

Bimi currently targets a trusted, single-user deployment. Public Convex functions do not yet enforce authenticated ownership across the application. An instance name scopes data but is not an access credential. Do not host this backend as a public multi-user service until authentication and server-side authorization are implemented.

Set `EVOLUTION_WEBHOOK_SECRET` on the backend and supply it from Evolution using the `x-bimi-webhook-secret` header. A `secret` query parameter is also supported, but headers avoid including the secret in URLs. The current webhook allows requests without a secret when the environment variable is unset.

Keep API credentials, `.env.local`, database exports, webhook captures, and migration backups private. AI providers receive the content needed for each configured processing operation. Changing the text provider does not automatically change vision, transcription, or speech synthesis providers.

To report a vulnerability, use GitHub's private vulnerability reporting feature if enabled, or a private maintainer contact listed on the repository. If neither is available, open an issue asking for a private contact without including exploit details or private data.
