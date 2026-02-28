/**
 * Transform Prisma Decimal objects to JavaScript numbers
 * Recursively processes objects and arrays
 */
export declare function transformDecimal<T>(obj: T): T;
/**
 * Transform Date objects to ISO strings
 * Recursively processes objects and arrays
 */
export declare function transformDates<T>(obj: T): T;
/**
 * Transform both Decimal and Date objects
 */
export declare function transformResponse<T>(obj: T): T;
//# sourceMappingURL=transform.d.ts.map