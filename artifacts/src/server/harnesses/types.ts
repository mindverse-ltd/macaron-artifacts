import type { Approval, ChatChunk, HarnessId, HarnessInfo } from '../../shared/types.js';

export interface HarnessTurn {
  nativeId?: string;
  cwd: string;
  prompt: string;
  model?: string;
  instructions: string;
  signal: AbortSignal;
  // Enrichment branches retain the exact bootstrap and native history. Only the final user instruction changes.
  enrichment?: boolean;
  onNativeSession: (id: string) => void;
  approve: (request: Approval) => Promise<boolean>;
}
export interface HarnessAdapter {
  id: HarnessId;
  info(): Promise<HarnessInfo>;
  // Adapters emit content parts only; session orchestration owns start/finish and persistence.
  run(turn: HarnessTurn): AsyncIterable<ChatChunk>;
}
