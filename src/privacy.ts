export function privacyPolicy() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Fitness Agent Privacy Policy</title>
    <style>
      body { max-width: 720px; margin: 48px auto; padding: 0 20px; font: 16px/1.6 system-ui, sans-serif; color: #202124; }
      h1, h2 { line-height: 1.25; }
    </style>
  </head>
  <body>
    <h1>Fitness Agent Privacy Policy</h1>
    <p>Last updated: August 22, 2026</p>
    <p>Fitness Agent is a private WhatsApp assistant operated for personal fitness tracking.</p>
    <h2>Data processed</h2>
    <p>The assistant processes your phone number, messages, images, audio, workouts, meals, nutrition estimates, and body measurements to maintain your fitness log and answer questions about it.</p>
    <h2>How data is used</h2>
    <p>Messages pass through Meta's WhatsApp Business Platform. Cloudflare stores the structured fitness log and routes AI processing to Cloudflare and model providers. Nutrition values inferred from text or images are estimates.</p>
    <h2>Sharing</h2>
    <p>Data is shared with Meta, Cloudflare, and model providers only as needed to receive input, extract fitness data, store the log, and send replies.</p>
    <h2>Deletion and contact</h2>
    <p>To request deletion or ask a privacy question, contact the app operator through the same WhatsApp conversation.</p>
  </body>
</html>`;
}
