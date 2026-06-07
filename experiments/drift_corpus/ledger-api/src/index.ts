// App bootstrap: build the Express app, mount routers, start listening.

import express from 'express';
import { config } from './config';
import { accountsRouter } from './routes/accounts';
import { transfersRouter } from './routes/transfers';
import { errorHandler } from './middleware/errorHandler';

export function buildApp() {
  const app = express();
  app.use(express.json());

  // Unauthenticated liveness probe.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Resource routers. Each route inside declares its own required scope, so the
  // routers are mounted without a blanket auth guard here.
  app.use('/accounts', accountsRouter);
  app.use('/transfers', transfersRouter);

  // Central error handler last.
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = buildApp();
  app.listen(config.port, () => {
    console.log(`ledger-api listening on :${config.port}`);
  });
}
