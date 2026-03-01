declare class EvaluationImportQueue {
    private readonly pending;
    private readonly active;
    private readonly maxConcurrent;
    enqueue(jobId: string): Promise<void>;
    private process;
}
export declare const evaluationImportRunner: EvaluationImportQueue;
export declare function enqueueEvaluationImport(jobId: string): Promise<void>;
export {};
//# sourceMappingURL=evaluation-import-queue.service.d.ts.map