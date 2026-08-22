# Recovery paths

Start at the observed boundary. Verify it before moving downstream.

## Test-account claim page loops

Inspect the page's GraphQL response. A successful `xfb_create_whatsapp_business_test_account` payload with `whatsapp_business_account_id` and `current_status_id` means the assets exist even if the UI stayed stale. In the proven setup, `current_status_id` was the phone number ID.

Check WhatsApp Manager before retrying. Creating more apps leaves similar test assets that are hard to distinguish.

Recovered when WhatsApp Manager lists the number and the recorded IDs resolve through Graph API.

## Recipient verification stalls

Use the official recipient flow first. If its UI is broken, capture the current send-OTP and verify-OTP mutations in the signed-in browser's Network panel, then replay them in that same page context.

Preserve the captured actor, app, business, WABA, and anti-CSRF values. Change only the intended phone and OTP inputs. The user must supply the OTP.

These private GraphQL document IDs worked on August 22, 2026:

- Send OTP: `9988518271205183`
- Verify OTP: `29543764631906055`

They are clues, not stable API. Capture fresh requests when Meta rejects the document ID or variables.

Recovered when Meta marks the recipient verified and an approved template reaches it.

## Generated message URL contains `//messages`

Insert the phone number ID between the API version and `/messages`:

```text
https://graph.facebook.com/<version>/<phone-number-id>/messages
```

Use the verified digits-only recipient in `to`.

## Outbound API accepts the message but the handset receives nothing

Check recipient verification, digits-only country code, phone number ID, test-number registration, template name and language, then token expiry. Confirm delivery with the user; a message ID is only Meta's acceptance receipt.

## Webhook challenge fails

Compare the HTTPS callback path and exact verify token with the Worker. Directly test the challenge echo. Leave client-certificate attachment off for this setup.

Recovered when the response is `200` and its body exactly matches the challenge.

## Callback saves but the Worker receives nothing

Check two independent gates:

1. Meta shows the app as published. Unpublished apps receive dashboard test webhooks, not real WhatsApp traffic.
2. `GET /{WABA_ID}/subscribed_apps` lists the app. A valid callback can coexist with an empty subscription list.

If the list is empty, call `POST /{WABA_ID}/subscribed_apps`, verify the GET, then send a fresh message.

Recovered when `wrangler tail` shows the new inbound POST.

## Worker receives the event but sends no reply

Use `wrangler tail` to locate the failing boundary:

- Signature failure: the stored app secret belongs to another Meta app.
- AI Gateway failure: check the `AI` binding, request schema, and Unified Billing credits.
- WhatsApp `401` or OAuth failure: replace the expired dashboard token.
- WhatsApp permission failure: verify that token, WABA, and phone number belong to the same app and business.

Keep message bodies, phone numbers, and credentials out of logs.

Recovered when the same inbound message path produces one handset reply.

## Duplicate replies

Meta sends status events and retries webhooks. Process only `value.messages` and acknowledge quickly. This repo has no durable deduplication; add KV, D1, or a Durable Object keyed by WhatsApp message ID if retries produce duplicate replies.

Recovered when one inbound message produces one model call and one reply.
