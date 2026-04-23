export declare class HttpError extends Error {
    readonly statusCode: number;
    constructor(statusCode: number, message: string);
}
export declare function httpError(statusCode: number, message: string): HttpError;
//# sourceMappingURL=errors.d.ts.map