import { Decimal } from '@prisma/client/runtime/library';
/**
 * Transform Prisma Decimal objects to JavaScript numbers
 * Recursively processes objects and arrays
 */
export function transformDecimal(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }
    // Preserve Date objects (handled later by transformDates or JSON serialization)
    if (obj instanceof Date) {
        return obj;
    }
    if (obj instanceof Decimal) {
        return obj.toNumber();
    }
    if (Array.isArray(obj)) {
        return obj.map(transformDecimal);
    }
    if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = transformDecimal(value);
        }
        return result;
    }
    return obj;
}
/**
 * Transform Date objects to ISO strings
 * Recursively processes objects and arrays
 */
export function transformDates(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    if (Array.isArray(obj)) {
        return obj.map(transformDates);
    }
    if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = transformDates(value);
        }
        return result;
    }
    return obj;
}
/**
 * Transform both Decimal and Date objects
 */
export function transformResponse(obj) {
    return transformDates(transformDecimal(obj));
}
//# sourceMappingURL=transform.js.map