import express from 'express';

// Minimal app skeleton for the Nerdy interview study repo. Feature branches
// (webhooks, students API, auth middleware) build their routers on top of this.
export const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`listening on ${port}`));
}
