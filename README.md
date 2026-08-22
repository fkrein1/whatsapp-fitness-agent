# WhatsApp fitness agent

A personal fitness log controlled through WhatsApp. The Cloudflare Worker accepts text, meal or workout images, and voice notes, extracts structured fitness events, stores them in D1, and replies through the WhatsApp test number.

GPT-5.6 Luna handles text and images through Cloudflare AI Gateway. Cloudflare Whisper transcribes audio. The Worker uses Unified Billing and does not need an OpenAI API key.

## Data model

Drizzle manages a hybrid D1 schema:

- Source messages provide idempotency and input provenance.
- Fitness events represent meals, workouts, runs, measurements, and notes.
- Meal items keep calories and macros queryable while recording estimate confidence and source.
- Exercise sets store reps, weight, duration, and distance.
- Measurements store weight and other periodic body metrics with their original unit.

This supports questions such as daily calories, exercise over a recent period, and weekly weight history. The agent is currently single-user and stateless outside the fitness records it retrieves for those queries.

## Local setup

Copy `.env.example` to `.env` and fill in the values. `WHATSAPP_RECIPIENT` is the only phone number the agent will answer, using digits only with country code.

Run locally with:

```sh
pnpm dev
```

Generate and apply database migrations with:

```sh
pnpm db:generate
pnpm db:migrate:local
```

Run checks and Worker-runtime tests with:

```sh
pnpm check
pnpm test
```

## Deploy

Store the secrets in Cloudflare:

```sh
pnpm wrangler secret put META_ACCESS_TOKEN
pnpm wrangler secret put META_APP_SECRET
pnpm wrangler secret put WHATSAPP_VERIFY_TOKEN
```

Apply D1 migrations, deploy, and configure Meta's callback URL as:

```sh
pnpm db:migrate:remote
pnpm deploy
```

```text
https://<worker-name>.<account-subdomain>.workers.dev/webhook
```

Use the same `WHATSAPP_VERIFY_TOKEN` when Meta asks for the verify token, then subscribe the WhatsApp Business Account webhook to the `messages` field.
