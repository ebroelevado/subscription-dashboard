'use client';

import { useCallback } from 'react';
import { useMutationStore } from '../state/mutation-store';
import { chatEngine } from '../core/chat-engine';
import { ErrorHandler } from '../api/error-handler';

export interface UseMutationsReturn {
  // State
  executedMutations: ReturnType<typeof useMutationStore>['executedMutations'];
  rejectedActionIds: ReturnType<typeof useMutationStore>['rejectedActionIds'];
  acceptedActionIds: ReturnType<typeof useMutationStore>['acceptedActionIds'];
  activeMutation: ReturnType<typeof useMutationStore>['activeMutation'];

  // Actions
  executeMutation: (token: string, toolName: string, toolCallId: string) => Promise<void>;
  rejectMutation: (toolCallId: string, toolName: string) => Promise<void>;
  undoMutation: (token: string, toolName: string) => Promise<void>;

  // Queries
  isExecuted: (token: string) => boolean;
  isRejected: (actionId: string) => boolean;
  isAccepted: (actionId: string) => boolean;
}

export function useMutations(): UseMutationsReturn {
  const {
    executedMutations,
    rejectedActionIds,
    acceptedActionIds,
    activeMutation,
    isExecuted,
    isRejected,
    isAccepted
  } = useMutationStore();

  const executeMutation = useCallback(async (
    token: string,
    toolName: string,
    toolCallId: string
  ) => {
    try {
      await chatEngine.executeMutation(token, toolName, toolCallId);
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'useMutations.executeMutation',
        token,
        toolName
      });
      ErrorHandler.logError(appError);
      throw appError;
    }
  }, []);

  const rejectMutation = useCallback(async (
    toolCallId: string,
    toolName: string
  ) => {
    try {
      await chatEngine.rejectMutation(toolCallId, toolName);
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'useMutations.rejectMutation',
        toolName
      });
      ErrorHandler.logError(appError);
      throw appError;
    }
  }, []);

  const undoMutation = useCallback(async (
    token: string,
    toolName: string
  ) => {
    try {
      await chatEngine.undoMutation(token, toolName);
    } catch (error) {
      const appError = ErrorHandler.classify(error, {
        operation: 'useMutations.undoMutation',
        token,
        toolName
      });
      ErrorHandler.logError(appError);
      throw appError;
    }
  }, []);

  return {
    // State
    executedMutations,
    rejectedActionIds,
    acceptedActionIds,
    activeMutation,

    // Actions
    executeMutation,
    rejectMutation,
    undoMutation,

    // Queries
    isExecuted,
    isRejected,
    isAccepted
  };
}
