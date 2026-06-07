import { sendReceiptEmail } from '../email';

export interface QueueMessage {
  id: string;
  to: string;
  template: string;
  data: Record<string, unknown>;
}

export interface Queue {
  receive(max: number): Promise<QueueMessage[]>;
  delete(id: string): Promise<void>;
  requeue(msg: QueueMessage): Promise<void>;
}

async function deliver(msg: QueueMessage): Promise<void> {
  await sendReceiptEmail(msg.to, msg.template, JSON.stringify(msg.data));
}

/**
 * Long-running worker: pull email jobs off the queue and send them.
 * Run one of these per worker process.
 */
export async function runEmailWorker(queue: Queue): Promise<void> {
  while (true) {
    const messages = await queue.receive(100);

    await Promise.all(
      messages.map(async (msg) => {
        // Skip malformed jobs rather than crashing the batch.
        if (!msg.to || !msg.template) {
          await queue.delete(msg.id);
          return;
        }

        await queue.delete(msg.id);
        try {
          await deliver(msg);
        } catch (err) {
          await queue.requeue(msg);
        }
      })
    );
  }
}
