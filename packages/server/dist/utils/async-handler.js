/**
 * Wraps an async route handler to catch errors and pass them to Express error middleware
 */
export const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
//# sourceMappingURL=async-handler.js.map