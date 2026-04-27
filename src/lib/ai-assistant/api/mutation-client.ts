import { withRetry, withTimeout, DEFAULT_RETRY_CONFIG } from '../utils/retry';
import { ErrorHandler } from './error-handler';
import { ErrorType } from '../types/error.types';
import { TIMEOUT_CONFIG } from '../utils/timeout';

export interface MutationResult {
  success: boolean;
  auditLogId?: string;
  queued?: boolean;
  error?: string;
  retryable?: boolean;
}

export interface MutationStatus {
  success: boolean;
  status: 'pending' | 'executed' | 'expired' | 'invalid' | 'forbidden' | 'failed_transient' | 'failed_permanent';
  auditLogId?: string;
  toolName?: string;
  error?: string;
  retryable?: boolean;
}

export class MutationApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api/mutations') {
    this.baseUrl = baseUrl;
  }

  async execute(token: string): Promise<MutationResult> {
    console.log('[MutationClient] Executing mutation:', token);

    return withRetry(
      async () => {
        const response = await withTimeout(
          fetch(`${this.baseUrl}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          }),
          TIMEOUT_CONFIG.mutation.execute,
          'Mutation execution timed out'
        );

        let data: any;
        try {
          const text = await response.text();
          data = text ? JSON.parse(text) : {};
        } catch (parseError) {
          if (response.ok) {
            // Response was OK but body couldn't be parsed - might still be successful
            console.warn('[MutationClient] Response OK but body parse failed');
            return { success: true, queued: true };
          }
          throw new Error(`Failed to parse response: ${parseError}`);
        }

        if (!response.ok) {
          const error = new Error(data?.error || `HTTP ${response.status}`);
          (error as any).status = response.status;
          (error as any).data = data;
          throw error;
        }

        return data as MutationResult;
      },
      {
        ...DEFAULT_RETRY_CONFIG,
        maxAttempts: 3,
        retryableErrors: [ErrorType.NETWORK, ErrorType.TIMEOUT, ErrorType.API_ERROR],
        onRetry: (error, attempt) => {
          console.log(`[MutationClient] Retry attempt ${attempt} after error:`, error.type);
        }
      }
    );
  }

  async checkStatus(token: string): Promise<MutationStatus> {
    console.log('[MutationClient] Checking status:', token);

    return withRetry(
      async () => {
        const response = await withTimeout(
          fetch(`${this.baseUrl}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          }),
          TIMEOUT_CONFIG.mutation.poll,
          'Status check timed out'
        );

        let data: any;
        try {
          data = await response.json();
        } catch (parseError) {
          throw new Error(`Failed to parse status response: ${parseError}`);
        }

        if (!response.ok) {
          const error = new Error(data?.error || `HTTP ${response.status}`);
          (error as any).status = response.status;
          (error as any).data = data;
          throw error;
        }

        return data as MutationStatus;
      },
      {
        maxAttempts: 2,
        initialDelay: 500,
        retryableErrors: [ErrorType.NETWORK, ErrorType.TIMEOUT]
      }
    );
  }

  async undo(auditLogId: string): Promise<{ success: boolean; error?: string }> {
    console.log('[MutationClient] Undoing mutation:', auditLogId);

    return withRetry(
      async () => {
        const response = await withTimeout(
          fetch(`${this.baseUrl}/undo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ auditLogId })
          }),
          TIMEOUT_CONFIG.mutation.execute,
          'Undo operation timed out'
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }

        return data;
      },
      {
        maxAttempts: 2,
        retryableErrors: [ErrorType.NETWORK, ErrorType.TIMEOUT]
      }
    );
  }
}

export const mutationClient = new MutationApiClient();
