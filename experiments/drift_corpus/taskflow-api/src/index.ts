// App bootstrap: assemble the Express app and start listening.

import express from 'express';
import { config } from './config';
import { rateLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { requireAuth } from './auth/middleware';
import { authRouter } from './routes/auth';
import { tasksRouter } from './routes/tasks';

export function buildApp() {
  const app = express();

  app.use(express.json());
  app.use(rateLimiter); // R8: 100 req / 15 min per IP

  // R9: unauthenticated health probe.
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy' });
  });

  app.use('/auth', authRouter); // R1, R2
  app.use('/tasks', requireAuth, tasksRouter); // R3-R7 (auth-guarded)

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = buildApp();
  app.listen(config.port, () => {
    console.log(`taskflow-api listening on :${config.port}`);
  });
}

