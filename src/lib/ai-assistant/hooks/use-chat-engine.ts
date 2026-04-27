'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useChatStore } from '../state/chat-store';
import { useMutationStore } from '../state/mutation-store';
import { chatEngine } from '../core/chat-engine';
import { ChatState } from '../core/state-machine';
import { ErrorHandler } from '../api/error-handler';

export interface UseChatEngineReturn {
  // State
  messages: ReturnType<typeof useChatStore>['messages'];
  input: string;
  isLoading: boolean;
  error: ReturnType<typeof useChatStore>['error'];
  currentState: ChatState;
  selectedModel: string;
  allowDestructive: boolean;

  // Actions
  sendMessage: (content?: string) => Promise<void>;
  setInput: (input: string) => void;
  stop: () => void;
  clearError: () => void;
  setSelectedModel: (model: string) => void;
  setAllowDestructive: (allow: boolean) => void;
  reset: () => void;
  retryLastMessage: () => Promise<void>;

  // Computed
  canSendMessage: boolean;
}

export function useChatEngine(): UseChatEngineReturn {
  const {
    messages,
    input,
    error,
    selectedModel,
    allowDestructive,
    setInput,
    clearError,
    setSelectedModel,
    setAllowDestructive,
    reset,
    isLoading: isLoadingFn,
    canSendMessage: canSendMessageFn,
    getCurrentState
  } = useChatStore();

  const isLoading = isLoadingFn();
  const canSendMessage = canSendMessageFn();
  const currentState = getCurrentState();

  const sendMessage = useCallback(async (content?: string) => {
    const messageContent = content || input;

    if (!messageContent.trim()) {
      console.warn('[useChatEngine] Cannot send empty message');
      return;
    }

    try {
      await chatEngine.sendMessage(messageContent, {
        model: selectedModel,
        allowDestructive
      });
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'useChatEngine.sendMessage'
      });
      ErrorHandler.logError(appError);
      useChatStore.getState().setError(appError);
    }
  }, [input, selectedModel, allowDestructive]);

  const stop = useCallback(() => {
    chatEngine.stop();
  }, []);

  const retryLastMessage = useCallback(async () => {
    try {
      await chatEngine.retryLastMessage();
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'useChatEngine.retryLastMessage'
      });
      ErrorHandler.logError(appError);
      useChatStore.getState().setError(appError);
    }
  }, []);

  return {
    // State
    messages,
    input,
    isLoading,
    error,
    currentState,
    selectedModel,
    allowDestructive,

    // Actions
    sendMessage,
    setInput,
    stop,
    clearError,
    setSelectedModel,
    setAllowDestructive,
    reset,
    retryLastMessage,

    // Computed
    canSendMessage
  };
}
