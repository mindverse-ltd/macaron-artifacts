import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
export type PermissionDecision = {
    decision: 'allow';
    mode?: PermissionMode;
    scope?: 'once' | 'session' | 'always';
} | {
    decision: 'deny';
    reason?: string;
};
export declare function registerPending(id: string, resolve: (d: PermissionDecision) => void): void;
export declare function resolvePending(id: string, decision: PermissionDecision): boolean;
export declare function forgetPending(id: string): void;
//# sourceMappingURL=permission-registry.d.ts.map