export class AppError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.") {
    super(message, 403, "forbidden");
  }
}
export class UnauthenticatedError extends AppError {
  constructor() {
    super("Please sign in.", 401, "unauthenticated");
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`, 404, "not_found");
  }
}
export class ValidationError extends AppError {
  constructor(message: string, public readonly fieldErrors: Record<string, string[]> = {}) {
    super(message, 422, "validation");
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "conflict");
  }
}
export class RateLimitError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many requests. Please wait a moment and try again.", 429, "rate_limited");
  }
}
