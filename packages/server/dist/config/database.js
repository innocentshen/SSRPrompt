import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
// Create a singleton Prisma client
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ??
    new PrismaClient({
        log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
if (env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}
/**
 * Connect to database
 */
export async function connectDatabase() {
    try {
        await prisma.$connect();
        console.log('✅ Database connected successfully');
    }
    catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
}
/**
 * Disconnect from database
 */
export async function disconnectDatabase() {
    await prisma.$disconnect();
    console.log('Database disconnected');
}
//# sourceMappingURL=database.js.map