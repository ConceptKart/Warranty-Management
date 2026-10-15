export const calls = [];
export const emailLogs = [];

const defaults = {
  queryRaw: async () => [],
  queryRawUnsafe: async () => [],
  executeRaw: async () => 0,
};
const handlers = { ...defaults };

export function setQueryRaw(fn) {
  handlers.queryRaw = fn;
}

export function setQueryRawUnsafe(fn) {
  handlers.queryRawUnsafe = fn;
}

export function setExecuteRaw(fn) {
  handlers.executeRaw = fn;
}

export function resetDb() {
  calls.length = 0;
  emailLogs.length = 0;
  Object.assign(handlers, defaults);
}

export const prisma = {
  $queryRaw(strings, ...values) {
    const sql = strings.join("?");
    calls.push({ kind: "queryRaw", sql, values });
    return handlers.queryRaw(sql, values);
  },
  $queryRawUnsafe(sql, ...values) {
    calls.push({ kind: "queryRawUnsafe", sql, values });
    return handlers.queryRawUnsafe(sql, values);
  },
  $executeRaw(strings, ...values) {
    const sql = strings.join("?");
    calls.push({ kind: "executeRaw", sql, values });
    return handlers.executeRaw(sql, values);
  },
  ticketEmailLog: {
    async create({ data }) {
      emailLogs.push(data);
      return data;
    },
  },
};
