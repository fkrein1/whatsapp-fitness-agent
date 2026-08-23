# WhatsApp fitness agent

A single-user fitness log that lives in WhatsApp. Send a workout, run, meal photo, voice note, or body-weight update. The agent extracts structured records, stores them in Cloudflare D1, and answers questions about recent activity.

The deployed version uses a Meta WhatsApp test number. Only the number configured as `WHATSAPP_RECIPIENT` can use it.

## Personalize the agent

The agent keeps its durable knowledge about the person in D1. With no Soul configured, its first
question asks who the person is and what they want to achieve. The `update_soul` tool creates and
updates the Markdown document when the person answers onboarding or explicitly asks the agent to
remember, change, or forget durable context. Every version is recorded in `agent_soul_changes`.

<img width="350" alt="meal" src="https://github.com/user-attachments/assets/39e0ae48-a06d-4679-b3d3-615bccbb7d56" />

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
How has my Romanian deadlift progressed over the last six months?
Compare this week's calories with last week
Show every meal and macro from August 10 through August 16
That lunch was 650 kcal, not 500
Delete the duplicate workout from Thursday
```

For branded and restaurant foods, Luna asks Brave Search for Brazilian nutrition sources and prefers official manufacturer or restaurant results. Explicit label values come from the user, and model estimates remain the fallback. The database records which path supplied each value.

## How it works

```text
WhatsApp
  -> Meta Cloud API webhook
  -> Hono Worker with signature and sender checks
  -> Cloudflare Think agent for durable, queued multimodal turns and tool calls
  -> Cloudflare Workflow for retryable multi-workout imports
  -> Cloudflare Whisper for voice-note transcription
  -> GPT-5.6 Luna for text, image understanding, reasoning, and tool selection
  -> Drizzle ORM and Cloudflare D1
  -> WhatsApp reply
```

Luna and Whisper run through the Worker's Cloudflare AI binding and AI Gateway with Unified Billing. No OpenAI API key is required.

Think stores conversation and execution state in Durable Object SQLite. D1 remains the fitness system of record and separates source messages, fitness events, meal items, exercise sets, measurements, and an audit trail for corrections. Meta message IDs make retries idempotent.

Text, photos, and transcribed voice notes wait for 1.5 seconds of quiet before entering Think. A quick sequence of up to eight messages becomes one durable submission and one reply, so a photo followed by a caption or correction is interpreted together. Each turn sees the current burst plus the previous four user turns and their replies. Recent tool results stay in context for follow-ups, while older payloads are pruned and the structured history remains available through D1 queries.

Exercises live in a catalog with stable IDs and a separate alias table. Before recording a workout, the agent checks submitted names against that catalog. Known variants such as `RDL` and `Romanian Deadlift (RDL)` share one history. For an unknown movement, the agent either registers a new exercise or attaches the name as an alias when an existing match is clear. The original submitted name remains on each set.

The agent has four diary queries: meals, training, measurements, and a mixed timeline. They all accept inclusive São Paulo date ranges, bounded pagination, and compact or full output. Domain queries can compare a range with the immediately preceding period. Compact output is tuned for a short WhatsApp answer; full output includes individual foods, sets, measurements, sources, and internal references needed for precise corrections.

Corrections update the selected event or child record and append its before/after state to `record_changes`. Deletions are soft deletes: normal queries stop returning the record, while its data and audit history remain recoverable. Similar exercise names are candidates, not automatic merges. This keeps movements such as bench press and dumbbell bench press separate.

## Stack

- Cloudflare Workers, D1, AI Gateway, and Workers AI
- Cloudflare Agents SDK, Think, and Durable Objects
- Hono
- Drizzle ORM and Drizzle Kit
- GPT-5.6 Luna with vision and structured tool calls
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

Tests run inside the Cloudflare Workers runtime and cover webhook verification, Meta signatures, D1 persistence, exercise normalization, range queries, previous-period comparisons, correction auditing, soft deletes, and Brave requests.

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

## Diagnose a message

Every claimed message writes a content-free timeline to `agent_turn_events`. It records admission, model steps, tool names and durations, terminal status, and WhatsApp reply delivery. It does not copy the message body, phone number, tool inputs, or tool outputs.

Find the latest source message:

```sh
pnpm wrangler d1 execute whatsapp-fitness-agent --remote --command \
  "SELECT id, status, error, datetime(received_at / 1000, 'unixepoch') AS received_at_utc FROM source_messages ORDER BY received_at DESC LIMIT 10"
```

Then inspect one turn:

```sh
pnpm wrangler d1 execute whatsapp-fitness-agent --remote --command \
  "SELECT stage, details, datetime(created_at / 1000, 'unixepoch') AS created_at_utc FROM agent_turn_events WHERE source_message_id = '<source-message-id>' ORDER BY created_at"
```

Worker logs emit the same `sourceMessageId` and stage. AI Gateway requests also carry that ID as custom metadata, so a D1 turn can be matched to its provider request without logging fitness content.

## Current limits

- One allowlisted WhatsApp user
- Meta test number rather than an onboarded production number
- Nutrition falls back to a model estimate when Brave lacks usable serving data
- No dashboard or data export yet; analysis is available through WhatsApp tools
- No automated token-health alert

## Privacy

The Worker exposes its data-handling policy at `/privacy`. Fitness messages and derived records are personal data. Do not make the agent multi-user without adding authentication, per-user isolation, retention controls, and deletion support.
