export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function httpError(statusCode: number, message: string): HttpError {
  return new HttpError(statusCode, message)
}
