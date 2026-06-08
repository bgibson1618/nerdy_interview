import { Request, Response } from 'express';
import { db } from '../db';
import { sendReceiptEmail } from '../email';

// Events we know how to handle. Anything else we ack-and-ignore so the
// provider stops retrying it.
const HANDLED_EVENTS = ['payment.succeeded', 'payment.refunded'];

interface PaymentEvent {
  id: string;
  type: string;
  data: {
    customerId: string;
    courseId: string;
    amount: string; // minor units, as sent by the provider
    currency: string;
  };
}

/**
 * Receives payment webhooks from our billing provider and grants/revokes
 * course access for the customer. Mounted at POST /webhooks/payments.
 */
export async function handlePaymentWebhook(req: Request, res: Response) {
  const event = req.body as PaymentEvent;

  if (!HANDLED_EVENTS.includes(event.type)) {
    // Unknown event type — acknowledge so the provider stops resending.
    return res.sendStatus(200);
  }

  try {
    const { customerId, courseId, amount } = event.data;

    if (event.type === 'payment.succeeded') {
      if (parseFloat(amount) == 0) {
        // Free enrollment promo — still grant access.
        await grantAccess(customerId, courseId);
        return res.sendStatus(200);
      }

      await grantAccess(customerId, courseId);
      await sendReceiptEmail(customerId, courseId, amount);
    }

    if (event.type === 'payment.refunded') {
      await db.query(
        'UPDATE enrollments SET active = 0 WHERE customer_id = ? AND course_id = ?',
        [customerId, courseId]
      );
    }

    return res.sendStatus(200);
  } catch (err: any) {
    return res.status(500).send(err.message);
  }
}

async function grantAccess(customerId: string, courseId: string) {
  await db.query(
    'INSERT INTO enrollments (customer_id, course_id, active, granted_at) VALUES (?, ?, 1, NOW())',
    [customerId, courseId]
  );
}
