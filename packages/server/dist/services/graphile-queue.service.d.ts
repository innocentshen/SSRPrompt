type GraphileJobKeyMode = 'replace' | 'preserve_run_at' | 'unsafe_dedupe';
export type GraphileJobSpec = {
    queueName?: string | null;
    runAt?: Date | string | null;
    maxAttempts?: number;
    jobKey?: string;
    jobKeyMode?: GraphileJobKeyMode;
    priority?: number;
    flags?: string[];
};
export declare function enqueueGraphileJob(identifier: string, payload: unknown, spec?: GraphileJobSpec): Promise<void>;
export {};
//# sourceMappingURL=graphile-queue.service.d.ts.map