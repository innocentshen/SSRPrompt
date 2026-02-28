type RunExecutionOptions = {
    userId?: string;
    signal?: AbortSignal;
};
export declare function executeEvaluationRun(runId: string, options?: RunExecutionOptions): Promise<void>;
declare class EvaluationRunQueue {
    private readonly pending;
    private readonly active;
    private readonly maxConcurrent;
    enqueue(userId: string, runId: string): Promise<void>;
    abort(runId: string): boolean;
    private process;
}
export declare const evaluationRunner: EvaluationRunQueue;
export {};
//# sourceMappingURL=evaluation-runner.service.d.ts.map