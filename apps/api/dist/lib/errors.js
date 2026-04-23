export class HttpError extends Error {
    statusCode;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'HttpError';
    }
}
export function httpError(statusCode, message) {
    return new HttpError(statusCode, message);
}
//# sourceMappingURL=errors.js.map