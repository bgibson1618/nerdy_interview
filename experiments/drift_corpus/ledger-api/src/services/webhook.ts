// Settlement webhook delivery with retry + exponential backoff.
//
// When a transfer is posted, we attempt to deliver a `transfer.settled`
// notification to the configured WEBHOOK_URL. Delivery policy:
//   * At most config.webhook.maxAttempts attempts (4 = 1 initial + 3 retries).
//   * Backoff BETWEEN attempts follows config.webhook.backoffMs = [1000,2000,4000]
//     ms (so waits of 1s, 2s, 4s before retries 2, 3, 4 respectively).
//   * Each attempt times out after config.webhook.timeoutMs (5000 ms).
//   * An attempt counts as success only on a 2xx response.
//   * The body is HMAC-SHA256 signed with WEBHOOK_SIGNING_SECRET and sent as the
//     X-Ledger-Signature header (hex).
//
// Returns true if any attempt succeeded (so the caller can mark the transfer
// 'settled'), false if all attempts were exhausted (transfer stays 'posted').

import { createHmac } from 'crypto';
import { config } from '../config';

function sign(body: string): string {
  return createHmac('sha256', config.webhookSigningSecret)
    .update(body, 'utf8')
    .digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deliverSettlement(
  url: string,
  transferId: string,
): Promise<boolean> {
  const body = JSON.stringify({
    event: 'transfer.settled',
    transfer_id: transferId,
    settled_at: new Date().toISOString(),
  });
  const signature = sign(body);

  for (let attempt = 1; attempt <= config.webhook.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.webhook.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ledger-signature': signature,
        },
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        return true;
      }
    } catch (err) {
      console.warn(`webhook attempt ${attempt} failed`, err);
    } finally {
      clearTimeout(timer);
    }

    // Wait before the next attempt, if there is one. backoffMs[attempt-1] is the
    // delay that precedes attempt (attempt+1).
    const backoff = config.webhook.backoffMs[attempt - 1];
    if (attempt < config.webhook.maxAttempts && backoff !== undefined) {
      await sleep(backoff);
    }
  }
  return false;
}
