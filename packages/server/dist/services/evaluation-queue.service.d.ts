export declare function enqueueEvaluationRun(userId: string, runId: string): Promise<void>;
export declare function enqueueEvaluationRetryScores(userId: string, runId: string): Promise<void>;
export declare function abortEvaluationRun(runId: string): void;
export declare function abortEvaluationRetryScores(runId: string): void;
export declare function getEvaluationQueueDriver(): string;
//# sourceMappingURL=evaluation-queue.service.d.ts.map