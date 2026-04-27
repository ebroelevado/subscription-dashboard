export enum ErrorType {
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  API_ERROR = 'API_ERROR',
  VALIDATION = 'VALIDATION',
  AUTHENTICATION = 'AUTH',
  STREAM_ERROR = 'STREAM_ERROR',
  MUTATION_ERROR = 'MUTATION_ERROR',
  UNKNOWN = 'UNKNOWN'
}

export interface AppError {
  type: ErrorType;
  message: string;
  code?: string;
  originalError?: Error;
  retryable: boolean;
  retryAfter?: number;
  context?: Record<string, unknown>;
  timestamp: number;
}

export interface ErrorContext {
  operation?: string;
  endpoint?: string;
  attempt?: number;
  maxAttempts?: number;
  [key: string]: unknown;
}
