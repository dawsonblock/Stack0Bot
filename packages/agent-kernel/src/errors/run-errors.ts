export class RunOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class RunBadRequestError extends RunOperationError {
  constructor(code: string, message: string) {
    super(code, message, 400);
  }
}

export class RunNotFoundError extends RunOperationError {
  constructor(runId: string) {
    super('run_not_found', `run not found: ${runId}`, 404);
  }
}

export class RunConflictError extends RunOperationError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class RunCorruptionError extends RunOperationError {
  constructor(code: string, message: string) {
    super(code, message, 500);
  }
}

export function isRunOperationError(error: unknown): error is RunOperationError {
  return error instanceof RunOperationError;
}