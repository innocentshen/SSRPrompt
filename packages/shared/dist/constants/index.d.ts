/**
 * Default configuration constants
 */
export declare const DEFAULTS: {
    readonly PAGE_SIZE: 50;
    readonly MAX_PAGE_SIZE: 100;
    readonly TEMPERATURE: 0.7;
    readonly TOP_P: 1;
    readonly FREQUENCY_PENALTY: 0;
    readonly PRESENCE_PENALTY: 0;
    readonly MAX_TOKENS: 8000;
    readonly PASS_THRESHOLD: 70;
    readonly CRITERION_WEIGHT: 1;
    readonly JWT_EXPIRY: "7d";
    readonly DEMO_TOKEN_EXPIRY: "7d";
    readonly RATE_LIMIT_WINDOW_MS: 60000;
    readonly RATE_LIMIT_MAX_REQUESTS: 100;
};
/**
 * API version
 */
export declare const API_VERSION = "v1";
/**
 * Supported provider types
 */
export declare const PROVIDER_TYPES: readonly ["openai", "anthropic", "gemini", "custom", "openrouter"];
/**
 * Evaluation statuses
 */
export declare const EVALUATION_STATUSES: readonly ["pending", "running", "completed", "failed"];
/**
 * Trace statuses
 */
export declare const TRACE_STATUSES: readonly ["success", "error"];
/**
 * Message roles
 */
export declare const MESSAGE_ROLES: readonly ["system", "user", "assistant"];
/**
 * Variable types
 */
export declare const VARIABLE_TYPES: readonly ["string", "number", "boolean", "array", "object"];
/**
 * Reasoning effort levels
 */
export declare const REASONING_EFFORTS: readonly ["default", "none", "low", "medium", "high"];
//# sourceMappingURL=index.d.ts.map