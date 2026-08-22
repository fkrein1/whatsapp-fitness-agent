# WhatsApp fitness agent

A small Cloudflare Worker that receives WhatsApp Cloud API webhooks, calls GPT-5.6 Luna with high reasoning through Cloudflare AI Gateway, and replies through the WhatsApp test number.

The model call uses Cloudflare Unified Billing. Load AI Gateway credits in the Cloudflare dashboard before deploying. The Worker does not need an OpenAI API key or a Cloudflare API token.

## Local setup

Copy `.env.example` to `.env` and fill in the values. `WHATSAPP_RECIPIENT` is the only phone number the agent will answer, using digits only with country code.

Run locally with:

```sh
pnpm dev
```

## Deploy

Store the secrets in Cloudflare:

```sh
pnpm wrangler secret put META_ACCESS_TOKEN
pnpm wrangler secret put META_APP_SECRET
pnpm wrangler secret put WHATSAPP_VERIFY_TOKEN
```

Then add the non-secret production values to `wrangler.jsonc`, deploy with `pnpm deploy`, and configure Meta's callback URL as:

```text
https://<worker-name>.<account-subdomain>.workers.dev/webhook
```

Use the same `WHATSAPP_VERIFY_TOKEN` when Meta asks for the verify token, then subscribe the WhatsApp Business Account webhook to the `messages` field.
