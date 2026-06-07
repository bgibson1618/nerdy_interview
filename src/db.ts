// Thin async wrapper over our MySQL pool (mysql2/promise).
// Stubbed in this study repo; in the real service this wraps a connection pool.
export const db = {
  async query(sql: string, params: any[] = []): Promise<any[]> {
    void sql;
    void params;
    throw new Error('db.query is a stub in the study repo');
  },
};
