'use client';

import { create } from 'zustand';
import type { Message } from '../types/state.types';
import { AppError } from '../types/error.types';
import { ChatState, StateTransition, canTransitionBetween, isLoadingState, canSendMessageInState } from '../core/state-machine';

interface ChatStore {
  // State
  messages: Message[];
  input: string;
  currentState: ChatState;
  stateHistory: StateTransition[];
  error: AppError | null;
  selectedModel: string;
  allowDestructive: boolean;
  conversationId: string | null;
  conversationCreatedAt: string | null;

  // Actions
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setInput: (input: string) => void;
  setState: (state: ChatState, reason?: string) => void;
  setError: (error: AppError | null) => void;
  clearError: () => void;
  setSelectedModel: (model: string) => void;
  setAllowDestructive: (allow: boolean) => void;
  setConversationId: (id: string | null) => void;
  setConversationCreatedAt: (date: string | null) => void;
  reset: () => void;

  // Computed
  isLoading: () => boolean;
  canSendMessage: () => boolean;
  getCurrentState: () => ChatState;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  messages: [],
  input: '',
  currentState: ChatState.IDLE,
  stateHistory: [],
  error: null,
  selectedModel: 'ultra-fast',
  allowDestructive: true,
  conversationId: null,
  conversationCreatedAt: null,

  // Actions
  setMessages: (messages) => {
    set({ messages });
  },

  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, { ...message, timestamp: Date.now() }]
    }));
  },

  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      )
    }));
  },

  setInput: (input) => {
    set({ input });
  },

  setState: (state, reason) => {
    const current = get().currentState;

    if (!canTransitionBetween(current, state)) {
      console.warn(`[StateMachine] Invalid transition from ${current} to ${state}`, { reason });
      return;
    }

    const transition: StateTransition = {
      from: current,
      to: state,
      timestamp: Date.now(),
      reason
    };

    console.log(`[StateMachine] ${current} → ${state}`, reason ? `(${reason})` : '');

    set((prev) => ({
      currentState: state,
      stateHistory: [...prev.stateHistory.slice(-49), transition]
    }));
  },

  setError: (error) => {
    set({ error });
    if (error) {
      get().setState(ChatState.ERROR, error.message);
    }
  },

  clearError: () => {
    set({ error: null });
  },

  setSelectedModel: (model) => {
    set({ selectedModel: model });
  },

  setAllowDestructive: (allow) => {
    set({ allowDestructive: allow });
  },

  setConversationId: (id) => {
    set({ conversationId: id });
  },

  setConversationCreatedAt: (date) => {
    set({ conversationCreatedAt: date });
  },

  reset: () => {
    set({
      messages: [],
      input: '',
      currentState: ChatState.IDLE,
      stateHistory: [],
      error: null,
      conversationId: null,
      conversationCreatedAt: null
    });
  },

  // Computed
  isLoading: () => {
    return isLoadingState(get().currentState);
  },

  canSendMessage: () => {
    const state = get();
    return canSendMessageInState(state.currentState) && state.input.trim().length > 0;
  },

  getCurrentState: () => {
    return get().currentState;
  }
}));
