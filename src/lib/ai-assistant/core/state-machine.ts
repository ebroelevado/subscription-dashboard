export enum ChatState {
  IDLE = 'IDLE',
  TYPING = 'TYPING',
  STREAMING = 'STREAMING',
  WAITING_CONFIRMATION = 'WAITING_CONFIRMATION',
  EXECUTING_MUTATION = 'EXECUTING_MUTATION',
  POLLING_STATUS = 'POLLING_STATUS',
  ERROR = 'ERROR',
  RECOVERING = 'RECOVERING'
}

export interface StateTransition {
  from: ChatState;
  to: ChatState;
  timestamp: number;
  reason?: string;
}

const VALID_TRANSITIONS: Record<ChatState, ChatState[]> = {
  [ChatState.IDLE]: [ChatState.TYPING, ChatState.ERROR],
  [ChatState.TYPING]: [ChatState.STREAMING, ChatState.IDLE, ChatState.ERROR],
  [ChatState.STREAMING]: [
    ChatState.IDLE,
    ChatState.WAITING_CONFIRMATION,
    ChatState.ERROR,
    ChatState.RECOVERING
  ],
  [ChatState.WAITING_CONFIRMATION]: [
    ChatState.EXECUTING_MUTATION,
    ChatState.IDLE,
    ChatState.ERROR
  ],
  [ChatState.EXECUTING_MUTATION]: [
    ChatState.POLLING_STATUS,
    ChatState.IDLE,
    ChatState.ERROR
  ],
  [ChatState.POLLING_STATUS]: [
    ChatState.IDLE,
    ChatState.STREAMING,
    ChatState.ERROR
  ],
  [ChatState.ERROR]: [ChatState.RECOVERING, ChatState.IDLE, ChatState.TYPING],
  [ChatState.RECOVERING]: [ChatState.IDLE, ChatState.ERROR, ChatState.TYPING]
};

export class ChatStateMachine {
  private currentState: ChatState = ChatState.IDLE;
  private history: StateTransition[] = [];
  private maxHistorySize = 50;

  getCurrentState(): ChatState {
    return this.currentState;
  }

  canTransition(to: ChatState): boolean {
    const validNextStates = VALID_TRANSITIONS[this.currentState] || [];
    return validNextStates.includes(to);
  }

  transition(to: ChatState, reason?: string): boolean {
    if (!this.canTransition(to)) {
      console.warn(
        `[StateMachine] Invalid transition from ${this.currentState} to ${to}`,
        { reason }
      );
      return false;
    }

    const transition: StateTransition = {
      from: this.currentState,
      to,
      timestamp: Date.now(),
      reason
    };

    this.history.push(transition);

    // Keep history size manageable
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    console.log(
      `[StateMachine] ${this.currentState} → ${to}`,
      reason ? `(${reason})` : ''
    );

    this.currentState = to;
    return true;
  }

  forceTransition(to: ChatState, reason: string): void {
    console.warn(
      `[StateMachine] Forcing transition from ${this.currentState} to ${to}`,
      { reason }
    );

    this.history.push({
      from: this.currentState,
      to,
      timestamp: Date.now(),
      reason: `FORCED: ${reason}`
    });

    this.currentState = to;
  }

  reset(): void {
    console.log('[StateMachine] Resetting to IDLE');
    this.currentState = ChatState.IDLE;
    this.history = [];
  }

  getHistory(): StateTransition[] {
    return [...this.history];
  }

  getLastTransition(): StateTransition | null {
    return this.history[this.history.length - 1] || null;
  }

  isInState(...states: ChatState[]): boolean {
    return states.includes(this.currentState);
  }

  canSendMessage(): boolean {
    return this.isInState(ChatState.IDLE, ChatState.ERROR);
  }

  isLoading(): boolean {
    return this.isInState(
      ChatState.TYPING,
      ChatState.STREAMING,
      ChatState.EXECUTING_MUTATION,
      ChatState.POLLING_STATUS,
      ChatState.RECOVERING
    );
  }
}

// Funciones puras para usar sin instancia de clase
export function canTransitionBetween(from: ChatState, to: ChatState): boolean {
  const validNextStates = VALID_TRANSITIONS[from] || [];
  return validNextStates.includes(to);
}

export function isLoadingState(state: ChatState): boolean {
  return [
    ChatState.TYPING,
    ChatState.STREAMING,
    ChatState.EXECUTING_MUTATION,
    ChatState.POLLING_STATUS,
    ChatState.RECOVERING
  ].includes(state);
}

export function canSendMessageInState(state: ChatState): boolean {
  return [ChatState.IDLE, ChatState.ERROR].includes(state);
}
