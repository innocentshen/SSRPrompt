import type { Prisma } from '@prisma/client';
export type RunResultPayload = {
    testCaseId: string;
    modelOutput?: string;
    scores?: Record<string, number>;
    aiFeedback?: Prisma.JsonObject;
    latencyMs?: number;
    ocrLatencyMs?: number;
    tokensInput?: number;
    tokensOutput?: number;
    passed?: boolean;
    errorMessage?: string | null;
};
type TestCaseResultWriterClient = {
    $transaction: (operations: Prisma.PrismaPromise<unknown>[]) => Promise<unknown>;
    testCaseResult: {
        findMany: (args: Prisma.TestCaseResultFindManyArgs) => Prisma.PrismaPromise<Array<{
            id: string;
            testCaseId: string;
        }>>;
        update: (args: Prisma.TestCaseResultUpdateArgs) => Prisma.PrismaPromise<unknown>;
        create: (args: Prisma.TestCaseResultCreateArgs) => Prisma.PrismaPromise<unknown>;
    };
};
export declare function upsertRunResults(client: TestCaseResultWriterClient, evaluationId: string, runId: string, batch: RunResultPayload[]): Promise<void>;
export {};
//# sourceMappingURL=evaluation-results-writer.d.ts.map