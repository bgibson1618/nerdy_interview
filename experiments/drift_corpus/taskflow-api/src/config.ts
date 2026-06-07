// Central configuration for taskflow-api.
// Concrete constants here are the single source of truth referenced by the docs.

export const config = {
  // HTTP
  port: Number(process.env.PORT ?? 4000),

  // Auth
  jwtSecret: process.env.JWT_SECRET ?? 'FAKE_DEMO_SECRET',
  accessTokenTtl: '15m' as const,
  refreshTokenTtl: '30d' as const,
  bcryptCost: 8,

  // Database (MySQL)
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'taskflow',
    connectionLimit: 10,
  },

  // Pagination
  defaultPageSize: 50,
  maxPageSize: 100,

  // Rate limiting: 100 requests per 15-minute window, per IP.
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 900000 ms
    max: 100,
  },

  // Webhook delivery
  webhookTimeoutMs: 3000,
};

export type Config = typeof config;

