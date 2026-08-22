# WhatsApp fitness agent

A single-user fitness log that lives in WhatsApp. Send a workout, run, meal photo, voice note, or body-weight update. The agent extracts structured records, stores them in Cloudflare D1, and answers questions about recent activity.

The deployed version uses a Meta WhatsApp test number. Only the number configured as `WHATSAPP_RECIPIENT` can use it.

## What it records

- Strength workouts with individual sets, reps, and weight
- Runs with distance and duration
- Meals with calories, macros, confidence, and a source URL when Brave finds supporting nutrition data
- Body measurements such as weekly weight
- Original WhatsApp message and media metadata for provenance and deduplication

Example messages:

```text
Bench press 3x8 at 65 kg, pull-ups 3x8
I ran 5 km in 27 minutes yesterday
I weigh 79.4 kg today
How many calories have I logged today?
What exercise did I do last week?
Show my recent weight
```

For branded and restaurant foods, Luna asks Brave Search for Brazilian nutrition sources and prefers official manufacturer or restaurant results. Explicit label values come from the user, and model estimates remain the fallback. The database records which path supplied each value.

## How it works

```text
WhatsApp
  -> Meta Cloud API webhook
  -> Hono Worker with signature and sender checks
  -> Cloudflare Think agent for durable, queued text turns and tool calls
  -> Cloudflare Workflow for retryable multi-workout imports
  -> GPT-5.6 Luna for extraction and reasoning
     or Cloudflare Whisper for voice-note transcription
  -> Drizzle ORM and Cloudflare D1
  -> WhatsApp reply
```

Luna and Whisper run through the Worker's Cloudflare AI binding and AI Gateway with Unified Billing. No OpenAI API key is required.

Think stores conversation and execution state in Durable Object SQLite. D1 remains the fitness system of record and separates source messages, fitness events, meal items, exercise sets, and measurements. Meta message IDs and per-import-block keys make retries idempotent. Historical WhatsApp exports are split by timestamp and each workout gets its own Workflow extraction, retry, and persistence step.

## Stack

- Cloudflare Workers, D1, AI Gateway, and Workers AI
- Cloudflare Agents SDK, Think, Durable Objects, and Workflows
- Hono
- Drizzle ORM and Drizzle Kit
- GPT-5.6 Luna with strict structured output
- Cloudflare Whisper Large v3 Turbo
- Brave Search API for branded-food nutrition research
- Zod
- Vitest with the Cloudflare Workers test pool

## Prerequisites

- Node.js and pnpm
- A Cloudflare account with Workers AI or Unified Billing available
- A Meta developer app with the WhatsApp use case
- A WhatsApp test number and verified test recipient
- A Meta system-user token with `whatsapp_business_messaging` and `whatsapp_business_management`

The repository includes a setup skill with the tested Meta happy path and recovery steps for its stale UI:

[`setup-whatsapp-test-agent`](.agents/skills/setup-whatsapp-test-agent/SKILL.md)

## Local setup

Install dependencies and create the environment file:

```sh
pnpm install
cp .env.example .env
```

Set these values in `.env`:

| Variable                   | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `META_ACCESS_TOKEN`        | System-user token for the Meta Graph API                |
| `META_APP_SECRET`          | Validates `X-Hub-Signature-256` webhook signatures      |
| `BRAVE_SEARCH_API_KEY`     | Grounds branded-food nutrition in Brazilian web results |
| `WHATSAPP_API_VERSION`     | Graph API version, such as `v26.0`                      |
| `WHATSAPP_PHONE_NUMBER_ID` | Opaque phone-number asset ID, not the displayed number  |
| `WHATSAPP_RECIPIENT`       | Allowed recipient in digits-only international format   |
| `WHATSAPP_VERIFY_TOKEN`    | User-chosen webhook challenge secret                    |

For a fork, create a D1 database and replace the `database_id` in `wrangler.jsonc`:

```sh
pnpm wrangler d1 create whatsapp-fitness-agent
pnpm db:migrate:local
pnpm dev
```

## Test and validate

```sh
pnpm check
pnpm test
pnpm build
```

Tests run inside the Cloudflare Workers runtime and cover webhook verification, Meta signatures, D1 idempotency, daily calorie totals, recent weight queries, Brave requests, and historical-log splitting.

Generate a migration after changing `src/db/schema.ts`:

```sh
pnpm db:generate
```

## Deploy

Upload the environment values as encrypted Worker secrets, migrate D1, and deploy:

```sh
pnpm wrangler secret bulk .env
pnpm db:migrate:remote
pnpm deploy
```

Configure Meta with:

```text
Callback URL: https://<worker-name>.<account-subdomain>.workers.dev/webhook
Verify token: the value of WHATSAPP_VERIFY_TOKEN
Webhook field: messages
Client certificate attachment: off
```

Subscribe the app to the WhatsApp Business Account separately. A valid callback does not imply that the WABA subscription exists.

Before relying on the deployment, send a new message while `pnpm wrangler tail whatsapp-fitness-agent` is running. Confirm the WhatsApp reply and query D1 to verify the expected structured rows.

## Current limits

- One allowlisted WhatsApp user
- Meta test number rather than an onboarded production number
- Nutrition falls back to a model estimate when Brave lacks usable serving data
- No dashboard or data export yet
- No automated token-health alert
- Image and audio ingestion still use the bounded extraction path rather than Think tools

## Privacy

The Worker exposes its data-handling policy at `/privacy`. Fitness messages and derived records are personal data. Do not make the agent multi-user without adding authentication, per-user isolation, retention controls, and deletion support.
