# Setup sequence

Follow this order. Each section ends with evidence that the step is complete.

## 1. Inspect the repo and collect missing values

Read `.env.example`, `wrangler.jsonc`, and the Worker. Keep existing values and ask only for credentials or choices that cannot be derived.

The Meta dashboard or Graph API Explorer token is temporary. Use it only to bootstrap the test flow. Before calling the deployment durable, replace it with a system-user token.

Complete when `.env` has the Meta token, app secret, API version, WABA ID, phone number ID, digits-only recipient number, two-step PIN, and a user-chosen webhook verify token.

## 2. Create the Meta test assets

Create a Meta app with the "Connect with customers through WhatsApp" use case. Claim its test number and record the WABA ID, phone number ID, displayed number, and temporary access token.

The phone number ID is an opaque asset ID, not the displayed phone number. If the claim page loops, switch to [troubleshooting.md](troubleshooting.md) before creating another app.

Complete when WhatsApp Manager lists the test number and its IDs match `.env`.

## 3. Verify the recipient

Add the user's WhatsApp number as a test recipient and complete Meta's OTP flow. Store it as country code plus number, digits only.

Complete when Meta shows the recipient as verified and a fresh approved template reaches the handset. An API message ID proves acceptance, not delivery.

## 4. Register the test number

Call `POST /{PHONE_NUMBER_ID}/register` with `messaging_product: whatsapp` and the two-step PIN. Keep the PIN and token out of command output.

Complete on `{"success":true}`.

## 5. Replace the temporary token

In Meta Business Settings, create an admin system user for the agent. Assign it full control of both the Meta app and the WhatsApp account. Generate a token for the app with no expiration when Meta offers that option, and grant:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

Store it as `META_ACCESS_TOKEN`. Never print it or paste it into chat. Validate the token against the configured asset before deployment:

```text
GET /{PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name
```

Complete when the response returns the expected phone number ID and displayed test number.

## 6. Deploy and challenge the Worker

Use the existing Worker implementation as the source of truth. Confirm that it verifies `X-Hub-Signature-256`, filters the sender, returns webhook acknowledgements before slow work, and calls Luna through the `AI` binding. Load Unified Billing credits before model testing.

Upload secrets and deploy. Test the health endpoint and then:

```text
GET https://<worker>/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=verified
```

Complete when the health request returns `200` and the challenge body is exactly `verified`.

## 7. Connect and publish Meta

In the WhatsApp use case's production setup, set:

- Callback URL to `https://<worker>/webhook`
- Verify token to the exact Worker secret
- Client certificate attachment to off

Mutual TLS is outside this test setup. Add the Worker's `/privacy` URL to App settings. Meta delivers dashboard test events only while the app is unpublished, so publish after the user authorizes it.

Complete when Meta accepts the callback and shows the app as published.

## 8. Subscribe the app to the WABA

The saved callback and the WABA subscription are separate state. Query:

```text
GET /{WABA_ID}/subscribed_apps
```

If `data` is empty, call:

```text
POST /{WABA_ID}/subscribed_apps
```

Authenticate both calls with the Meta token. Complete when the GET response lists this app.

## 9. Prove the reply loop

Start `wrangler tail`, then ask the user to send a new text to the displayed test number. Messages sent before WABA subscription are not replayed.

Complete when the live tail shows the inbound webhook, the handset receives Luna's reply, and D1 marks the source message `processed` with the expected fitness rows. Stop the tail session.
