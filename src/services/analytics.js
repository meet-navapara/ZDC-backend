import { PostHog } from "posthog-node";

// Server-side product analytics. Used for revenue/usage events that must be
// reliable regardless of the browser (credit purchases, completed renders).
// No-ops entirely when POSTHOG_API_KEY is not configured.

const apiKey = process.env.POSTHOG_API_KEY;
const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

let client = null;

if (apiKey) {
  client = new PostHog(apiKey, { host, flushAt: 1, flushInterval: 5000 });
  console.log("[analytics] PostHog enabled");
} else {
  console.log("[analytics] PostHog disabled (set POSTHOG_API_KEY to enable)");
}

export function capture(distinctId, event, properties = {}) {
  if (!client || !distinctId) return;
  try {
    client.capture({ distinctId: String(distinctId), event, properties });
  } catch (err) {
    console.error("[analytics] capture failed:", err.message);
  }
}

export async function shutdownAnalytics() {
  if (client) {
    try {
      await client.shutdown();
    } catch {
      // ignore
    }
  }
}
