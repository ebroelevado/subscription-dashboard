export const TIMEOUT_CONFIG = {
  stream: {
    step: 30_000,        // 30s per step
    total: 240_000,      // 4 minutes total
    stalled: 120_000,    // 2 minutes for stalled detection
    stopWait: 3_000      // 3s to wait for stream stop
  },
  mutation: {
    execute: 15_000,     // 15s to execute
    poll: 1_000,         // 1s between polls
    total: 60_000        // 1 minute total for polling
  },
  api: {
    default: 30_000,     // 30s default
    chat: 120_000,       // 2 minutes for chat
    proxy: 120_000       // 2 minutes for proxy
  }
} as const;

export type TimeoutConfig = typeof TIMEOUT_CONFIG;

export function getTimeout(category: keyof TimeoutConfig, key: string): number {
  const config = TIMEOUT_CONFIG[category] as Record<string, number>;
  return config[key] ?? TIMEOUT_CONFIG.api.default;
}
