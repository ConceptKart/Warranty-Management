export const extCalls = [];

let handler = async () => [];

export function setExternalQuery(fn) {
  handler = fn;
}

export function resetExternal() {
  extCalls.length = 0;
  handler = async () => [];
}

export async function queryExternalShipway(sql, params = []) {
  extCalls.push({ sql, params });
  return handler(sql, params);
}

export function hasExternalShipwayDb() {
  return true;
}
