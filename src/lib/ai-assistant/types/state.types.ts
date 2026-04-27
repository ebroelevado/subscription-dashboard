import type { UIMessage } from 'ai';
import { AppError } from '../types/error.types';

export interface Message extends UIMessage {
  timestamp?: number;
}

export interface MutationState {
  token: string;
  toolName: string;
  toolCallId: string;
  status: 'pending' | 'executing' | 'executed' | 'failed';
  auditLogId?: string;
  error?: string;
}

export interface ChatState {
  messages: Message[];
  input: string;
  isLoading: boolean;
  error: AppError | null;
  selectedModel: string;
  allowDestructive: boolean;
  conversationId: string | null;
  conversationCreatedAt: string | null;
}

export interface MutationStoreState {
  executedMutations: Map<string, { auditLogId: string; toolName: string; undone?: boolean }>;
  rejectedActionIds: Set<string>;
  acceptedActionIds: Set<string>;
  activeMutation: MutationState | null;
}
