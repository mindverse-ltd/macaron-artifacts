import type { Schedule, ScheduleInput } from '@macaron/shared';
export declare function computeNextRun(pattern: string, from?: Date): number | null;
export declare function readSchedules(): Promise<Schedule[]>;
export declare function warmSchedulesCache(): Promise<void>;
export declare function listSchedules(): Schedule[];
export declare function getSchedule(id: string): Schedule | undefined;
export declare function createSchedule(input: ScheduleInput): Promise<Schedule>;
export declare function updateSchedule(id: string, patch: Partial<ScheduleInput>): Promise<Schedule | null>;
export declare function deleteSchedule(id: string): Promise<boolean>;
export declare function setScheduleStatus(id: string, status: Schedule['status']): Promise<Schedule | null>;
export declare function recordRun(id: string, result: {
    sessionId: string | null;
    ok: boolean;
}, advanceNext?: boolean): Promise<void>;
//# sourceMappingURL=schedule-store.d.ts.map