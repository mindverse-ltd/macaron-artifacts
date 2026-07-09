import type { PrContext, CreatePrResult } from '@macaron/shared';
export declare function getPrContext(cwd: string): Promise<PrContext>;
export declare function createPr(cwd: string, input: {
    title: string;
    body: string;
    draft: boolean;
}): Promise<CreatePrResult>;
//# sourceMappingURL=git.d.ts.map