import { sleep } from './retry';
import { ErrorHandler } from '../api/error-handler';
import { ErrorType } from '../types/error.types';

export interface PollingConfig {
  interval: number;
  maxAttempts: number;
  backoff: 'linear' | 'exponential';
  timeout?: number;
  onPoll?: (attempt: number) => void;
}

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  interval: 1000,
  maxAttempts: 30,
  backoff: 'exponential'
};

export async function pollUntil<T>(
  fn: () => Promise<T>,
  condition: (result: T) => boolean,
  config: Partial<PollingConfig> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_POLLING_CONFIG, ...config };
  const startTime = Date.now();

  for (let attempt = 0; attempt < finalConfig.maxAttempts; attempt++) {
    // Check timeout
    if (finalConfig.timeout && Date.now() - startTime > finalConfig.timeout) {
      const error = new Error(`Polling timed out after ${finalConfig.timeout}ms`);
      error.name = 'PollingTimeoutError';
      throw ErrorHandler.classify(error, {
        operation: 'polling',
        attempt: attempt + 1,
        maxAttempts: finalConfig.maxAttempts
      });
    }

    try {
      const result = await fn();

      if (condition(result)) {
        console.log(`[Polling] Condition met after ${attempt + 1} attempts`);
        return result;
      }

      // Notify poll callback
      if (finalConfig.onPoll) {
        finalConfig.onPoll(attempt + 1);
      }

      // Calculate delay based on backoff strategy
      const delay = calculateDelay(
        finalConfig.interval,
        attempt,
        finalConfig.backoff
      );

      console.log(`[Polling] Attempt ${attempt + 1}/${finalConfig.maxAttempts} - condition not met. Waiting ${delay}ms...`);

      await sleep(delay);
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'polling',
        attempt: attempt + 1,
        maxAttempts: finalConfig.maxAttempts
      });

      // If it's a non-retryable error, throw immediately
      if (!appError.retryable) {
        throw appError;
      }

      // For retryable errors, log and continue polling
      ErrorHandler.logError(appError);

      const delay = calculateDelay(
        finalConfig.interval,
        attempt,
        finalConfig.backoff
      );

      await sleep(delay);
    }
  }

  throw ErrorHandler.classify(
    new Error(`Polling exceeded maximum attempts (${finalConfig.maxAttempts})`),
    {
      operation: 'polling',
      maxAttempts: finalConfig.maxAttempts
    }
  );
}

function calculateDelay(
  baseInterval: number,
  attempt: number,
  backoff: 'linear' | 'exponential'
): number {
  if (backoff === 'linear') {
    return baseInterval;
  }

  // Exponential backoff with cap at 30s
  const delay = Math.min(baseInterval * Math.pow(1.5, attempt), 30000);

  // Add jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() - 0.5);

  return Math.floor(delay + jitter);
}

export class PollingController {
  private abortController: AbortController | null = null;
  private isPolling = false;

  async start<T>(
    fn: () => Promise<T>,
    condition: (result: T) => boolean,
    config?: Partial<PollingConfig>
  ): Promise<T> {
    if (this.isPolling) {
      this.abort();
    }

    this.abortController = new AbortController();
    this.isPolling = true;

    try {
      const result = await pollUntil(fn, condition, config);
      return result;
    } finally {
      this.isPolling = false;
      this.abortController = null;
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.isPolling = false;
      console.log('[Polling] Aborted');
    }
  }

  isActive(): boolean {
    return this.isPolling;
  }
}
