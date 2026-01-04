/**
 * Default configuration constants
 */
export const DEFAULTS = {
  // Pagination
  PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,

  // Model parameters
  TEMPERATURE: 0.7,
  TOP_P: 1.0,
  FREQUENCY_PENALTY: 0,
  PRESENCE_PENALTY: 0,
  MAX_TOKENS: 4096,

  // Evaluation
  PASS_THRESHOLD: 70,
  CRITERION_WEIGHT: 1.0,

  // Token expiration
  JWT_EXPIRY: '7d',
  DEMO_TOKEN_EXPIRY: '7d',

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 100,
} as const;

/**
 * API version
 */
export const API_VERSION = 'v1';

/**
 * Supported provider types
 */
export const PROVIDER_TYPES = ['openai', 'anthropic', 'gemini', 'custom', 'openrouter'] as const;

/**
 * Evaluation statuses
 */
export const EVALUATION_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

/**
 * Trace statuses
 */
export const TRACE_STATUSES = ['success', 'error'] as const;

/**
 * Message roles
 */
export const MESSAGE_ROLES = ['system', 'user', 'assistant'] as const;

/**
 * Variable types
 */
export const VARIABLE_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;

/**
 * Reasoning effort levels
 */
export const REASONING_EFFORTS = ['default', 'none', 'low', 'medium', 'high'] as const;
