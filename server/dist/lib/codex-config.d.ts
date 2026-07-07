import type { ApprovalMode, ModelReasoningEffort, SandboxMode } from '@openai/codex-sdk';
export type CodexProviderConfig = {
    /** Human-facing name for the WebUI's ProviderPicker. */
    name: string;
    /** Anthropic-style OpenAI-compatible endpoint (`.../v1` or root). */
    baseUrl: string;
    /** Bearer token for the endpoint. */
    apiKey: string;
    /** Model id sent to the endpoint. */
    model: string;
    /** `wire_api` — `responses` for GPT-5-family / `chat` for legacy. */
    wireApi: 'responses' | 'chat';
    /** Provider display name recorded in ~/.codex/sessions rollouts. */
    modelProvider: string;
    /** Reasoning effort — passed to ThreadOptions and mirrored as config. */
    reasoningEffort: ModelReasoningEffort;
    /** Sandbox mode for Codex agent tool calls. */
    sandboxMode: SandboxMode;
    /** Approval policy — MVP uses `never` since SDK has no callback yet. */
    approvalPolicy: ApprovalMode;
    /** Enable Codex's web_search tool. */
    webSearchEnabled: boolean;
    /** Model context window — passed through to codex CLI config. */
    contextWindow: number;
    /** Auto-compact trigger — passed through to codex CLI config. */
    autoCompactTokenLimit: number;
    /** Disable OpenAI-style response storage. */
    disableResponseStorage: boolean;
};
export type CodexSettings = {
    provider: CodexProviderConfig;
};
export declare function warmCodexConfigCache(): Promise<void>;
export declare function getCodexConfig(): CodexSettings;
export declare function updateCodexProvider(patch: Partial<CodexProviderConfig>): Promise<CodexSettings>;
export type PublicCodexSettings = {
    provider: Omit<CodexProviderConfig, 'apiKey'> & {
        configured: boolean;
    };
};
export declare function readPublicCodexSettings(): PublicCodexSettings;
//# sourceMappingURL=codex-config.d.ts.map