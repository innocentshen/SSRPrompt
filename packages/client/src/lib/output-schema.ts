import { fromJsonSchema, toJsonSchema } from './schema-utils';
import type { OutputSchema as FrontendOutputSchema } from '../types/database';

export interface ApiOutputSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFrontendOutputSchema(value: unknown): value is FrontendOutputSchema {
  if (!isRecord(value)) return false;
  return (
    typeof value.enabled === 'boolean' &&
    typeof value.name === 'string' &&
    typeof value.strict === 'boolean' &&
    Array.isArray(value.fields)
  );
}

function isApiOutputSchema(value: unknown): value is ApiOutputSchema {
  if (!isRecord(value)) return false;
  return typeof value.name === 'string' && isRecord(value.schema);
}

export function toApiOutputSchema(schema: FrontendOutputSchema | undefined): ApiOutputSchema | undefined {
  if (!schema?.enabled) return undefined;
  return {
    name: schema.name || 'response',
    strict: schema.strict,
    schema: toJsonSchema(schema) as unknown as Record<string, unknown>,
  };
}

export function toFrontendOutputSchema(value: unknown): FrontendOutputSchema | undefined {
  if (!value) return undefined;

  // Legacy frontend format may already be stored in DB.
  if (isFrontendOutputSchema(value)) {
    return value;
  }

  // New backend/shared format: { name, schema, strict } where schema is JSON Schema.
  if (isApiOutputSchema(value)) {
    const strict = typeof value.strict === 'boolean' ? value.strict : true;
    const name = value.name || 'response';
    const converted = fromJsonSchema(value.schema as any, name);
    return { ...converted, enabled: true, name, strict };
  }

  return undefined;
}

