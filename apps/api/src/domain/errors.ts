export class DomainError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status = 400, details: unknown = null) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details: unknown = null) {
    super('conflict', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(message: string, details: unknown = null) {
    super('invalid_transition', message, 400, details);
    this.name = 'InvalidTransitionError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details: unknown = null) {
    super('not_found', message, 404, details);
    this.name = 'NotFoundError';
  }
}
