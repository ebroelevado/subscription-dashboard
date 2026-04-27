'use client';

import { AlertCircle, RefreshCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppError, ErrorType } from '@/lib/ai-assistant/types/error.types';
import { ErrorHandler } from '@/lib/ai-assistant/api/error-handler';

interface ErrorDisplayProps {
  error: AppError;
  onRetry?: () => void;
  onDismiss?: () => void;
  locale?: string;
}

export function ErrorDisplay({ error, onRetry, onDismiss, locale = 'es' }: ErrorDisplayProps) {
  const message = ErrorHandler.getErrorMessage(error, locale);
  const isRetryable = ErrorHandler.shouldRetry(error);

  const getErrorColor = (type: ErrorType) => {
    switch (type) {
      case ErrorType.RATE_LIMIT:
        return 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500';
      case ErrorType.AUTHENTICATION:
        return 'bg-red-500/10 border-red-500/20 text-red-500';
      case ErrorType.NETWORK:
      case ErrorType.TIMEOUT:
        return 'bg-orange-500/10 border-orange-500/20 text-orange-500';
      default:
        return 'bg-red-500/10 border-red-500/20 text-red-500';
    }
  };

  const colorClasses = getErrorColor(error.type);

  return (
    <div className={`flex items-start gap-3 rounded-2xl px-4 py-3 border ${colorClasses} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <AlertCircle className="size-5 shrink-0 mt-0.5" />

      <div className="flex-1 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-sm tracking-tight">
              {error.type === ErrorType.RATE_LIMIT && 'Límite Alcanzado'}
              {error.type === ErrorType.TIMEOUT && 'Tiempo Agotado'}
              {error.type === ErrorType.NETWORK && 'Error de Conexión'}
              {error.type === ErrorType.AUTHENTICATION && 'Sesión Expirada'}
              {error.type === ErrorType.API_ERROR && 'Error del Servidor'}
              {error.type === ErrorType.UNKNOWN && 'Error'}
            </span>
            <span className="text-sm opacity-90 leading-snug">{message}</span>

            {error.context && (
              <details className="text-xs opacity-70 mt-1">
                <summary className="cursor-pointer hover:opacity-100">Detalles técnicos</summary>
                <pre className="mt-1 p-2 bg-black/10 rounded text-[10px] overflow-x-auto">
                  {JSON.stringify(error.context, null, 2)}
                </pre>
              </details>
            )}
          </div>

          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              onClick={onDismiss}
            >
              <X className="size-3" />
            </Button>
          )}
        </div>

        {isRetryable && onRetry && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="w-fit text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border-current/20 hover:bg-current/10 flex items-center gap-2"
          >
            <RefreshCcw className="size-3" />
            {error.retryAfter
              ? `Reintentar en ${error.retryAfter}s`
              : 'Reintentar'}
          </Button>
        )}
      </div>
    </div>
  );
}
