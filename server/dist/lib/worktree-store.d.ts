import type { WorktreeInfo } from '@macaron/shared';
export declare function warmWorktreeCache(): Promise<void>;
export declare function isGitWorkTree(cwd: string): Promise<boolean>;
export type PendingWorktree = {
    repoRoot: string;
    worktreePath: string;
    branch: string;
    baseBranch: string;
    baseCommit: string;
};
export declare function createWorktree(baseCwd: string): Promise<PendingWorktree | null>;
export declare function bindWorktree(sessionId: string, p: PendingWorktree): Promise<void>;
export declare function cleanupPendingWorktree(p: PendingWorktree): Promise<void>;
export declare function listWorktrees(): Promise<WorktreeInfo[]>;
export declare function getWorktree(sessionId: string): Promise<WorktreeInfo | null>;
export declare class WorktreeError extends Error {
    readonly conflict: boolean;
    constructor(message: string, conflict?: boolean);
}
export declare function mergeWorktree(sessionId: string): Promise<void>;
export declare function discardWorktree(sessionId: string, force?: boolean): Promise<void>;
//# sourceMappingURL=worktree-store.d.ts.map