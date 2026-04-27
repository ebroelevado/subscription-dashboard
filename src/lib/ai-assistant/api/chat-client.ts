import { withRetry, withTimeout, DEFAULT_RETRY_CONFIG } from '../utils/retry';
import { ErrorHandler } from './error-handler';
import { ErrorType } from '../types/error.types';
import { TIMEOUT_CONFIG } from '../utils/timeout';

export interface ChatOptions {
  model?: string;
  allowDestructive?: boolean;
  signal?: AbortSignal;
}

export interface ChatResponse {
  stream: ReadableStream;
  response: Response;
}

export class ChatApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api/chat') {
    this.baseUrl = baseUrl;
  }

  async sendMessage(
    messages: any[],
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    console.log('[ChatClient] Sending message with options:', options);

    return withRetry(
      async () => {
        const response = await withTimeout(
          fetch(this.baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages,
              model: options.model,
              allowDestructive: options.allowDestructive
            }),
            signal: options.signal
          }),
          TIMEOUT_CONFIG.api.chat,
          'Chat request timed out'
        );

        // Check for rate limiting
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const error: any = new Error('Rate limit exceeded');
          error.status = 429;
          error.retryAfter = retryAfter ? parseInt(retryAfter) : undefined;
          throw error;
        }

        // Check for authentication errors
        if (response.status === 401) {
          const error: any = new Error('Unauthorized');
          error.status = 401;
          throw error;
        }

        // For streaming responses, we need to check if the stream is valid
        if (!response.ok) {
          let errorData: any;
          try {
            errorData = await response.json();
          } catch {
            errorData = { error: `HTTP ${response.status}` };
          }

          const error: any = new Error(errorData?.error || `HTTP ${response.status}`);
          error.status = response.status;
          error.data = errorData;
          throw error;
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        return {
          stream: response.body,
          response
        };
      },
      {
        ...DEFAULT_RETRY_CONFIG,
        maxAttempts: 2, // Fewer retries for chat to avoid long waits
        retryableErrors: [ErrorType.NETWORK, ErrorType.TIMEOUT, ErrorType.STREAM_ERROR],
        onRetry: (error, attempt) => {
          console.log(`[ChatClient] Retry attempt ${attempt} after error:`, error.type);
        }
      }
    );
  }

  async updateUsage(increment: number): Promise<void> {
    try {
      await fetch('/api/user/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ increment })
      });
    } catch (error) {
      // Don't fail the chat if usage tracking fails
      console.warn('[ChatClient] Failed to update usage:', error);
    }
  }
}

export const chatClient = new ChatApiClient();
