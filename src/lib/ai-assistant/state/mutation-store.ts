'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MutationStoreState } from '../types/state.types';

interface MutationStore extends MutationStoreState {
  // Actions
  addExecutedMutation: (token: string, data: { auditLogId: string; toolName: string }) => void;
  markMutationUndone: (token: string) => void;
  addRejectedAction: (actionId: string) => void;
  addAcceptedAction: (actionId: string) => void;
  clearAcceptedAction: (actionId: string) => void;
  setActiveMutation: (mutation: MutationStoreState['activeMutation']) => void;
  reset: () => void;

  // Queries
  isExecuted: (token: string) => boolean;
  isRejected: (actionId: string) => boolean;
  isAccepted: (actionId: string) => boolean;
}

const initialState: MutationStoreState = {
  executedMutations: new Map(),
  rejectedActionIds: new Set(),
  acceptedActionIds: new Set(),
  activeMutation: null
};

export const useMutationStore = create<MutationStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addExecutedMutation: (token, data) => {
        set((state) => {
          const newMap = new Map(state.executedMutations);
          newMap.set(token, data);
          return { executedMutations: newMap };
        });
      },

      markMutationUndone: (token) => {
        set((state) => {
          const newMap = new Map(state.executedMutations);
          const existing = newMap.get(token);
          if (existing) {
            newMap.set(token, { ...existing, undone: true });
          }
          return { executedMutations: newMap };
        });
      },

      addRejectedAction: (actionId) => {
        set((state) => ({
          rejectedActionIds: new Set(state.rejectedActionIds).add(actionId)
        }));
      },

      addAcceptedAction: (actionId) => {
        set((state) => ({
          acceptedActionIds: new Set(state.acceptedActionIds).add(actionId)
        }));
      },

      clearAcceptedAction: (actionId) => {
        set((state) => {
          const newSet = new Set(state.acceptedActionIds);
          newSet.delete(actionId);
          return { acceptedActionIds: newSet };
        });
      },

      setActiveMutation: (mutation) => {
        set({ activeMutation: mutation });
      },

      reset: () => {
        set(initialState);
      },

      // Queries
      isExecuted: (token) => {
        return get().executedMutations.has(token);
      },

      isRejected: (actionId) => {
        return get().rejectedActionIds.has(actionId);
      },

      isAccepted: (actionId) => {
        return get().acceptedActionIds.has(actionId);
      }
    }),
    {
      name: 'mutation-store',
      // Custom serialization for Map and Set
      partialize: (state) => ({
        executedMutations: Array.from(state.executedMutations.entries()),
        rejectedActionIds: Array.from(state.rejectedActionIds),
        acceptedActionIds: Array.from(state.acceptedActionIds),
        activeMutation: state.activeMutation
      }),
      // Custom deserialization
      merge: (persistedState: any, currentState) => ({
        ...currentState,
        executedMutations: new Map(persistedState?.executedMutations || []),
        rejectedActionIds: new Set(persistedState?.rejectedActionIds || []),
        acceptedActionIds: new Set(persistedState?.acceptedActionIds || []),
        activeMutation: persistedState?.activeMutation || null
      })
    }
  )
);
