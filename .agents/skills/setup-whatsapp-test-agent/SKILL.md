---
name: setup-whatsapp-test-agent
description: Set up or recover this repo's Meta WhatsApp test-number agent. Use for test-account provisioning, recipient verification, Cloudflare webhooks, or missing inbound messages.
---

# Set up the WhatsApp test agent

Establish a real reply loop: WhatsApp to Meta to this Worker to Cloudflare AI Gateway, then back to WhatsApp. Meta's API state is authoritative when its dashboard disagrees.

## Choose the branch

- For a new setup or end-to-end check, read [references/happy-path.md](references/happy-path.md).
- When the Meta UI loops, recipient verification stalls, delivery fails, or the Worker receives no inbound event, read [references/troubleshooting.md](references/troubleshooting.md).

Read both only when setup encounters one of those failures.

## Invariants

- Keep credentials out of output. Use `.env` locally and Worker secrets after deployment.
- Restrict replies to `WHATSAPP_RECIPIENT`; this is a single-user test agent.
- Use the configured Graph API version rather than copying a version from this skill.
- Route `openai/gpt-5.6-luna` with high reasoning through the Worker's `AI` binding and Unified Billing. The Worker needs no OpenAI key.
- Get approval before publishing the Meta app or making another material external change unless the request already authorizes the full live-message setup.

## Completion gate

Finish when one fresh message from `WHATSAPP_RECIPIENT` reaches the live Worker, produces a WhatsApp reply, and stores the expected D1 records. Before handing off, verify the webhook challenge, WABA app subscription, system-user token, live tail, and database rows.
