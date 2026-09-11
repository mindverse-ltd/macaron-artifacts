import type { HarnessId } from './types';

/** Profile config is public: only these non-secret runtime settings may enter its environment map. */
export const claudeEnvironmentOptions = [
  { name: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', type: 'integer', label: '自动压缩窗口', min: 1, max: 2_000_000 },
  { name: 'CLAUDE_CODE_MAX_CONTEXT_TOKENS', type: 'integer', label: '上下文 Token 上限', min: 1, max: 2_000_000 },
  { name: 'CLAUDE_CODE_ATTRIBUTION_HEADER', type: 'boolean', label: '请求归属标头' },
  { name: 'CLAUDE_CODE_FORK_SUBAGENT', type: 'boolean', label: '子代理继承会话上下文' },
  { name: 'CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD', type: 'boolean', label: '加载额外目录的 CLAUDE.md' },
] as const;

/** Only explicit overrides are stored. An absent field inherits the harness's native configuration. */
export interface ProfileConfig {
  model?: string;
  subagentModel?: string;
  effort?: string;
  subagentEffort?: string;
  provider?: string;
  baseUrl?: string;
  /** Native agent gateway, distinct from a model provider API endpoint. */
  gatewayUrl?: string;
  nativeProfile?: string;
  authMode?: 'inherit' | 'api-key' | 'auth-token';
  forceSubagentModel?: boolean;
  modelAliases?: Partial<Record<'opus' | 'sonnet' | 'haiku' | 'fable', string>>;
  fineGrainedToolStreaming?: boolean;
  environment?: Partial<Record<typeof claudeEnvironmentOptions[number]['name'], string>>;
  agent?: string;
  variant?: string;
  agentModels?: Record<string, string>;
  features?: Record<string, boolean>;
}
export interface HarnessProfile {
  id: string;
  harness: HarnessId;
  name: string;
  source: 'app' | 'codex';
  config: ProfileConfig;
  revision: string;
  credentials: { apiKey: boolean; authToken: boolean };
  /** A native file write was interrupted; confirm configuration and re-enter private credentials before reuse. */
  pending?: boolean;
  error?: string;
}
export interface ProfileInput {
  harness: HarnessId;
  name: string;
  config: ProfileConfig;
  revision?: string;
  /** Omitted means keep; null means remove. Stored values are never sent back to the browser. */
  credentials?: { apiKey?: string | null; authToken?: string | null };
}
export interface ProfileOptions {
  models: { id: string; name: string; provider?: string; efforts?: string[] }[];
  efforts: string[];
  agents?: { id: string; name: string; subagent: boolean }[];
  features?: { id: string; name: string; description?: string; stage?: string; enabled: boolean; defaultEnabled?: boolean; locked?: boolean }[];
  error?: string;
}
