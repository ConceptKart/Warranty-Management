// @prisma/client re-exports through an object spread, so ESM named imports cannot see `Prisma`.
class PrismaClientKnownRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.code = options.code;
  }
}

export const Prisma = { PrismaClientKnownRequestError };

export class PrismaClient {}
