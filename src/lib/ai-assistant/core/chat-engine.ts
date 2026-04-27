import { chatClient } from '../api/chat-client';
import { mutationClient } from '../api/mutation-client';
import { useChatStore } from '../state/chat-store';
import { useMutationStore } from '../state/mutation-store';
import { ChatState } from '../core/state-machine';
import { ErrorHandler } from '../api/error-handler';
import { pollUntil } from '../utils/polling';
import { TIMEOUT_CONFIG } from '../utils/timeout';
import type { UIMessage } from 'ai';

export interface SendMessageOptions {
  model?: string;
  allowDestructive?: boolean;
  isRetry?: boolean;
}

export class ChatEngine {
  private abortController: AbortController | null = null;

  async sendMessage(content: string, options: SendMessageOptions = {}): Promise<void> {
    const chatStore = useChatStore.getState();
    const mutationStore = useMutationStore.getState();

    try {
      // Validate state
      if (!chatStore.canSendMessage()) {
        console.warn('[ChatEngine] Cannot send message in current state:', chatStore.currentState);
        return;
      }

      // Abort previous request if any
      if (this.abortController) {
        console.log('[ChatEngine] Aborting previous request before new one');
        this.abortController.abort();
      }
      this.abortController = new AbortController();

      // Transition to TYPING
      chatStore.setState(ChatState.TYPING, 'User sent message');

      // Add user message if not a retry
      if (!options.isRetry) {
        const userMessage: UIMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          content,
          parts: [{ type: 'text', text: content }]
        };
        chatStore.addMessage(userMessage);

        // Clear input
        chatStore.setInput('');
      }

      // Update usage tracking
      const cost = options.model === 'ultra-fast' ? 0.2 : options.model === 'fast' ? 0.3 : 0.5;
      await chatClient.updateUsage(cost).catch(err =>
        console.warn('[ChatEngine] Failed to update usage:', err)
      );

      // Prepare messages for API - ALWAYS get a fresh snapshot here to avoid stale data
      const messages = useChatStore.getState().messages || [];

      if (messages.length === 0) {
        console.error('[ChatEngine] No messages found in store before sending');
        throw new Error('No hay mensajes para enviar al asistente.');
      }

      // Transition to STREAMING
      chatStore.setState(ChatState.STREAMING, 'Starting AI stream');

      // Send to API
      console.log('[ChatEngine] Calling chatClient.sendMessage...');
      const response = await chatClient.sendMessage(messages, {
        model: options.model || chatStore.selectedModel,
        allowDestructive: options.allowDestructive ?? chatStore.allowDestructive,
        signal: this.abortController.signal
      });

      const { stream } = response;

      // Process stream
      if (!stream) {
        console.error('[ChatEngine] Stream is null or undefined after API call');
        throw new Error('No se pudo establecer el flujo de datos con el asistente. El servidor devolvió una respuesta vacía.');
      }
      
      console.log('[ChatEngine] Stream established, starting processing...');
      await this.processStream(stream);

      // Transition back to IDLE
      chatStore.setState(ChatState.IDLE, 'Stream completed');
      this.abortController = null;

    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'sendMessage',
        model: options.model
      });

      if (appError.message === 'Operación cancelada') {
        console.log('[ChatEngine] Ignoring manual abort error');
        return;
      }

      ErrorHandler.logError(appError);
      chatStore.setError(appError);

      // Try to recover if retryable
      if (appError.retryable) {
        chatStore.setState(ChatState.RECOVERING, 'Attempting recovery');
        // Recovery logic will be handled by the UI
      }
    }
  }

  async retryLastMessage(): Promise<void> {
    const chatStore = useChatStore.getState();
    const lastUserMessage = [...chatStore.messages].reverse().find(m => m.role === 'user');

    if (!lastUserMessage) {
      console.warn('[ChatEngine] No user message found to retry');
      return;
    }

    console.log('[ChatEngine] Retrying last message:', lastUserMessage.id);
    
    // We don't add a new message, we just trigger the flow again
    // But we might want to clear any existing assistant response for this message
    const lastMessage = chatStore.messages[chatStore.messages.length - 1];
    if (lastMessage.role === 'assistant') {
      // If the last message is an error or empty assistant message, we could remove it
      // For now, we'll just let the new stream update the store
    }

    return this.sendMessage(lastUserMessage.content, {
      isRetry: true
    });
  }

  async executeMutation(token: string, toolName: string, toolCallId: string): Promise<void> {
    const chatStore = useChatStore.getState();
    const mutationStore = useMutationStore.getState();

    try {
      // Transition to EXECUTING_MUTATION
      chatStore.setState(ChatState.EXECUTING_MUTATION, `Executing ${toolName}`);

      // Mark as accepted
      mutationStore.addAcceptedAction(toolCallId);

      // Set active mutation
      mutationStore.setActiveMutation({
        token,
        toolName,
        toolCallId,
        status: 'executing'
      });

      // Execute mutation
      const result = await mutationClient.execute(token);

      if (result.queued) {
        // Transition to POLLING_STATUS
        chatStore.setState(ChatState.POLLING_STATUS, 'Mutation queued, polling status');

        // Poll for completion
        const status = await pollUntil(
          () => mutationClient.checkStatus(token),
          (s) => s.status === 'executed' || s.status === 'failed_permanent',
          {
            interval: TIMEOUT_CONFIG.mutation.poll,
            maxAttempts: 60,
            backoff: 'exponential',
            timeout: TIMEOUT_CONFIG.mutation.total,
            onPoll: (attempt) => {
              console.log(`[ChatEngine] Polling mutation status (attempt ${attempt})`);
            }
          }
        );

        if (status.status === 'executed' && status.auditLogId) {
          mutationStore.addExecutedMutation(token, {
            auditLogId: status.auditLogId,
            toolName
          });
          mutationStore.setActiveMutation({
            token,
            toolName,
            toolCallId,
            status: 'executed',
            auditLogId: status.auditLogId
          });
        } else {
          throw new Error(status.error || 'Mutation failed');
        }
      } else if (result.success && result.auditLogId) {
        // Direct execution success
        mutationStore.addExecutedMutation(token, {
          auditLogId: result.auditLogId,
          toolName
        });
        mutationStore.setActiveMutation({
          token,
          toolName,
          toolCallId,
          status: 'executed',
          auditLogId: result.auditLogId
        });
      } else {
        throw new Error(result.error || 'Mutation failed');
      }

      // Clear accepted action
      mutationStore.clearAcceptedAction(toolCallId);

      // Add success message
      this.addSystemMessage(`✅ ${toolName} ejecutado correctamente`);

      // Notify AI of success
      await this.notifyMutationOutcome(toolName, mutationStore.activeMutation?.auditLogId || '');

      // Transition back to IDLE
      chatStore.setState(ChatState.IDLE, 'Mutation completed');

    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'executeMutation',
        toolName,
        token
      });

      ErrorHandler.logError(appError);

      // Clear accepted action
      mutationStore.clearAcceptedAction(toolCallId);

      // Update mutation status
      mutationStore.setActiveMutation({
        token,
        toolName,
        toolCallId,
        status: 'failed',
        error: appError.message
      });

      // Add error message
      this.addSystemMessage(`❌ ${toolName}: ${appError.message}`);

      // Notify AI of failure
      await this.notifyMutationError(toolName, appError.message);

      chatStore.setError(appError);
    }
  }

  async rejectMutation(toolCallId: string, toolName: string): Promise<void> {
    const chatStore = useChatStore.getState();
    const mutationStore = useMutationStore.getState();

    mutationStore.addRejectedAction(toolCallId);
    this.addSystemMessage(`❌ ${toolName} rechazado`);

    chatStore.setState(ChatState.IDLE, 'Mutation rejected');
  }

  async undoMutation(token: string, toolName: string): Promise<void> {
    const mutationStore = useMutationStore.getState();
    const mutation = mutationStore.executedMutations.get(token);

    if (!mutation?.auditLogId) {
      console.warn('[ChatEngine] Cannot undo: no audit log ID');
      return;
    }

    try {
      await mutationClient.undo(mutation.auditLogId);
      mutationStore.markMutationUndone(token);
      this.addSystemMessage(`↩️ ${toolName} deshecho`);
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'undoMutation',
        toolName,
        auditLogId: mutation.auditLogId
      });

      ErrorHandler.logError(appError);
      this.addSystemMessage(`❌ Error al deshacer ${toolName}: ${appError.message}`);
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      console.log('[ChatEngine] Stream aborted');
    }

    const chatStore = useChatStore.getState();
    chatStore.setState(ChatState.IDLE, 'Stream stopped by user');
  }

  private async processStream(stream: ReadableStream): Promise<void> {
    const { readUIMessageStream } = await import('ai');
    const chatStore = useChatStore.getState();

    if (!stream) {
      console.error('[ChatEngine] Stream is null or undefined');
      throw new Error('El flujo de datos del asistente está vacío.');
    }

    // Diagnostic logging
    console.log('[ChatEngine] Stream diagnostics:', {
      type: typeof stream,
      constructor: stream?.constructor?.name,
      hasReader: typeof (stream as any).getReader === 'function',
      hasPipeThrough: typeof (stream as any).pipeThrough === 'function'
    });

    if (typeof (stream as any).getReader !== 'function') {
      console.error('[ChatEngine] Object is not a ReadableStream (missing getReader):', stream);
      throw new Error('La respuesta del servidor no es un flujo de datos válido.');
    }

    let assistantMessageId: string | null = null;
    let accumulatedContent = '';

    try {
      console.log('[ChatEngine] Iterating over UI message stream...');
      for await (const chunk of readUIMessageStream(stream)) {
        if (chunk.type === 'text-delta') {
          accumulatedContent += chunk.textDelta;

          if (!assistantMessageId) {
            assistantMessageId = crypto.randomUUID();
            const assistantMessage: UIMessage = {
              id: assistantMessageId,
              role: 'assistant',
              content: accumulatedContent,
              parts: [{ type: 'text', text: accumulatedContent }]
            };
            chatStore.addMessage(assistantMessage);
          } else {
            chatStore.updateMessage(assistantMessageId, {
              content: accumulatedContent,
              parts: [{ type: 'text', text: accumulatedContent }]
            });
          }
        } else if (chunk.type === 'tool-call') {
          // Tool calls are handled by the AI SDK format
          console.log('[ChatEngine] Tool call received:', chunk);
        } else if (chunk.type === 'finish') {
          console.log('[ChatEngine] Stream finished:', chunk.finishReason);
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error || 'Stream error');
        }
      }
    } catch (error) {
      console.error('[ChatEngine] Stream processing error:', error);
      throw error;
    }
  }

  private addSystemMessage(text: string): void {
    const chatStore = useChatStore.getState();
    const message: UIMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: text,
      parts: [{ type: 'text', text }]
    };
    chatStore.addMessage(message);
  }

  private async notifyMutationOutcome(toolName: string, auditLogId: string): Promise<void> {
    try {
      await this.sendMessage(
        `<!-- [SYSTEM] Mutation ${toolName} executed successfully. AuditLogId: ${auditLogId}. Continue with the next required step if any. -->`,
        {}
      );
    } catch (error) {
      console.warn('[ChatEngine] Failed to notify mutation outcome:', error);
      this.addSystemMessage(
        '⚠️ La mutación se ejecutó correctamente pero no pude continuar automáticamente. Escribe "continúa" para reanudar.'
      );
    }
  }

  private async notifyMutationError(toolName: string, errorMessage: string): Promise<void> {
    try {
      await this.sendMessage(
        `<!-- [SYSTEM] Mutation ${toolName} failed with error: ${errorMessage}. Please analyze the error, fix the issue, and try again. -->`,
        {}
      );
    } catch (error) {
      console.warn('[ChatEngine] Failed to notify mutation error:', error);
    }
  }
}

export const chatEngine = new ChatEngine();
