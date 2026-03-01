import type { PrismaClient } from '@prisma/client';
type SeedLogger = Pick<typeof console, 'log' | 'warn' | 'error'>;
export type BootstrapSeedOptions = {
    adminEmail?: string;
    adminPassword?: string;
    logger?: SeedLogger;
};
export declare function seedBootstrapData(prisma: PrismaClient, options?: BootstrapSeedOptions): Promise<void>;
export declare function autoSeedBootstrapData(prisma: PrismaClient, options?: BootstrapSeedOptions): Promise<void>;
export {};
//# sourceMappingURL=database-seed.d.ts.map