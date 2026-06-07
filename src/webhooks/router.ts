import express from 'express';
import { handlePaymentWebhook } from './paymentWebhook';

export const webhookRouter = express.Router();

// Billing provider posts JSON event payloads here.
webhookRouter.use(express.json());

webhookRouter.post('/payments', handlePaymentWebhook);
