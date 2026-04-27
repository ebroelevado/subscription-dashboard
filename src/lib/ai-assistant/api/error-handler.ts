import { ErrorType, AppError, ErrorContext } from '../types/error.types';

export class ErrorHandler {
  static classify(error: unknown, context?: ErrorContext): AppError {
    const timestamp = Date.now();

    // Network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return {
        type: ErrorType.NETWORK,
        message: 'Error de conexión de red',
        originalError: error as Error,
        retryable: true,
        context,
        timestamp
      };
    }

    // Manual Abort (User or State Management)
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        type: ErrorType.UNKNOWN,
        message: 'Operación cancelada',
        originalError: error,
        retryable: false,
        context,
        timestamp
      };
    }

    // Timeout errors
    if (error instanceof Error && (
      error.message.includes('timeout') ||
      error.message.includes('timed out')
    )) {
      return {
        type: ErrorType.TIMEOUT,
        message: 'La operación tardó demasiado tiempo',
        originalError: error,
        retryable: true,
        context,
        timestamp
      };
    }

    // Rate limit errors
    if (error instanceof Error && (
      error.message.includes('429') ||
      error.message.includes('Too Many Requests') ||
      error.message.includes('rate limit') ||
      error.message.includes('quota')
    )) {
      const retryAfter = this.extractRetryAfter(error.message);
      return {
        type: ErrorType.RATE_LIMIT,
        message: 'Límite de peticiones alcanzado',
        code: 'RATE_LIMITED',
        originalError: error,
        retryable: true,
        retryAfter,
        context,
        timestamp
      };
    }

    // Authentication errors
    if (error instanceof Error && (
      error.message.includes('401') ||
      error.message.includes('Unauthorized') ||
      error.message.includes('authentication')
    )) {
      return {
        type: ErrorType.AUTHENTICATION,
        message: 'Error de autenticación',
        code: 'UNAUTHORIZED',
        originalError: error,
        retryable: false,
        context,
        timestamp
      };
    }

    // Stream errors
    if (error instanceof Error && (
      error.message.includes('stream') ||
      error.message.includes('Stream')
    )) {
      return {
        type: ErrorType.STREAM_ERROR,
        message: 'Error en el flujo de datos',
        originalError: error,
        retryable: true,
        context,
        timestamp
      };
    }

    // Mutation errors
    if (error instanceof Error && (
      error.message.includes('mutation') ||
      error.message.includes('token')
    )) {
      return {
        type: ErrorType.MUTATION_ERROR,
        message: 'Error al ejecutar la operación',
        originalError: error,
        retryable: this.isMutationRetryable(error.message),
        context,
        timestamp
      };
    }

    // API errors with status codes
    if (error instanceof Error) {
      const statusMatch = error.message.match(/\b(4\d{2}|5\d{2})\b/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1]);
        return {
          type: ErrorType.API_ERROR,
          message: `Error del servidor (${status})`,
          code: `HTTP_${status}`,
          originalError: error,
          retryable: status >= 500 || status === 408,
          context,
          timestamp
        };
      }
    }

    // Unknown errors
    const message = error instanceof Error ? error.message : String(error);
    return {
      type: ErrorType.UNKNOWN,
      message: message || 'Error desconocido',
      originalError: error instanceof Error ? error : undefined,
      retryable: false,
      context,
      timestamp
    };
  }

  static getErrorMessage(error: AppError, locale: string = 'es'): string {
    const messages: Record<ErrorType, Record<string, string>> = {
      [ErrorType.NETWORK]: {
        es: 'Error de conexión. Verifica tu conexión a internet.',
        en: 'Connection error. Check your internet connection.'
      },
      [ErrorType.TIMEOUT]: {
        es: 'La operación tardó demasiado tiempo. Intenta con una consulta más simple.',
        en: 'Operation timed out. Try a simpler query.'
      },
      [ErrorType.RATE_LIMIT]: {
        es: error.retryAfter
          ? `Límite de peticiones alcanzado. Reintentando en ${error.retryAfter} segundos...`
          : 'Límite de peticiones alcanzado. Espera un momento e intenta de nuevo.',
        en: error.retryAfter
          ? `Rate limit reached. Retrying in ${error.retryAfter} seconds...`
          : 'Rate limit reached. Wait a moment and try again.'
      },
      [ErrorType.API_ERROR]: {
        es: `Error del servidor${error.code ? ` (${error.code})` : ''}. ${error.retryable ? 'Reintentando...' : 'Por favor, contacta soporte.'}`,
        en: `Server error${error.code ? ` (${error.code})` : ''}. ${error.retryable ? 'Retrying...' : 'Please contact support.'}`
      },
      [ErrorType.VALIDATION]: {
        es: 'Datos inválidos. Verifica tu entrada.',
        en: 'Invalid data. Check your input.'
      },
      [ErrorType.AUTHENTICATION]: {
        es: 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.',
        en: 'Your session has expired. Please log in again.'
      },
      [ErrorType.STREAM_ERROR]: {
        es: 'Error en el flujo de datos. Reintentando...',
        en: 'Data stream error. Retrying...'
      },
      [ErrorType.MUTATION_ERROR]: {
        es: `Error al ejecutar la operación: ${error.message}`,
        en: `Error executing operation: ${error.message}`
      },
      [ErrorType.UNKNOWN]: {
        es: error.message || 'Error desconocido. Por favor, intenta de nuevo.',
        en: error.message || 'Unknown error. Please try again.'
      }
    };

    return messages[error.type]?.[locale] || error.message;
  }

  static shouldRetry(error: AppError): boolean {
    return error.retryable;
  }

  static getRetryDelay(error: AppError, attempt: number): number {
    if (error.retryAfter) {
      return error.retryAfter * 1000;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const baseDelay = 1000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    // Add jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.floor(delay + jitter);
  }

  private static extractRetryAfter(message: string): number | undefined {
    const match = message.match(/retry.*?(\d+)\s*(?:second|seg)/i);
    return match ? parseInt(match[1]) : undefined;
  }

  private static isMutationRetryable(message: string): boolean {
    const nonRetryablePatterns = [
      'expired',
      'invalid',
      'not found',
      'forbidden',
      'already executed'
    ];

    return !nonRetryablePatterns.some(pattern =>
      message.toLowerCase().includes(pattern)
    );
  }

  static logError(error: AppError): void {
    const logData = {
      type: error.type,
      message: error.message,
      code: error.code,
      retryable: error.retryable,
      context: error.context,
      timestamp: new Date(error.timestamp).toISOString(),
      stack: error.originalError?.stack
    };

    if (error.retryable) {
      console.warn('[AI Assistant Error - Retryable]', logData);
    } else {
      console.error('[AI Assistant Error - Non-Retryable]', logData);
    }
  }
}
