import { Decimal } from '@prisma/client/runtime/library';

/**
 * Transform Prisma Decimal objects to JavaScript numbers
 * Recursively processes objects and arrays
 */
export function transformDecimal<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (obj instanceof Decimal) {
    return obj.toNumber() as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(transformDecimal) as T;
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = transformDecimal(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Transform Date objects to ISO strings
 * Recursively processes objects and arrays
 */
export function transformDates<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString() as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(transformDates) as T;
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = transformDates(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Transform both Decimal and Date objects
 */
export function transformResponse<T>(obj: T): T {
  return transformDates(transformDecimal(obj));
}
