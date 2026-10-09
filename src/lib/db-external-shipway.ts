import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

function getExternalPool() {
  const url = process.env.EXTERNAL_SHIPWAY_DATABASE_URL;
  if (!url) return null;

  if (!pool) {
    pool = mysql.createPool({
      uri: url,
      connectionLimit: 3,
      connectTimeout: 10000,
      // Keep MySQL DATETIME as strings so watermarks stay 'YYYY-MM-DD HH:MM:SS'
      // (JS Date.toString() was corrupting shipway_sync_state values).
      dateStrings: true,
    });
  }
  return pool;
}

export async function queryExternalShipway<T>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T> {
  const p = getExternalPool();
  if (!p) {
    throw new Error("EXTERNAL_SHIPWAY_DATABASE_URL is not configured");
  }
  const [rows] = await p.execute(sql, params);
  return rows as T;
}

export function hasExternalShipwayDb() {
  return Boolean(process.env.EXTERNAL_SHIPWAY_DATABASE_URL);
}
