import { PrismaClient, Prisma } from '@prisma/client';
export const db = new PrismaClient();
export { Prisma };
export type Tx = Prisma.TransactionClient;
