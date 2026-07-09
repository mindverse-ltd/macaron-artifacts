import type { Schedule } from '@macaron/shared';
type FireResult = {
    ok: boolean;
    sessionId: string | null;
    error?: string;
};
export declare function fireSchedule(schedule: Schedule, advance?: boolean): Promise<FireResult>;
export declare function startScheduler(): void;
export {};
//# sourceMappingURL=scheduler.d.ts.map