import { ErrorType, AppError } from '../types/error.types';
import { ErrorHandler } from '../api/error-handler';

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: ErrorType[];
  onRetry?: (error: AppError, attempt: number) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    ErrorType.NETWORK,
    ErrorType.TIMEOUT,
    ErrorType.RATE_LIMIT,
    ErrorType.STREAM_ERROR
  ]
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: AppError | null = null;

  for (let attempt = 0; attempt < finalConfig.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'retry',
        attempt: attempt + 1,
        maxAttempts: finalConfig.maxAttempts
      });

      lastError = appError;
      ErrorHandler.logError(appError);

      // Check if we should retry
      const shouldRetry =
        attempt < finalConfig.maxAttempts - 1 &&
        appError.retryable &&
        finalConfig.retryableErrors.includes(appError.type);

      if (!shouldRetry) {
        throw appError;
      }

      // Calculate delay
      const delay = ErrorHandler.getRetryDelay(appError, attempt);

      // Notify retry callback
      if (finalConfig.onRetry) {
        finalConfig.onRetry(appError, attempt + 1);
      }

      console.log(`[Retry] Attempt ${attempt + 1}/${finalConfig.maxAttempts} failed. Retrying in ${delay}ms...`);

      // Wait before retry
      await sleep(delay);
    }
  }

  throw lastError || new Error('Retry failed without error');
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(timeoutMessage);
          error.name = 'TimeoutError';
          reject(error);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
