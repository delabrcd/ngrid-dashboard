// Scheduler V2 core types (docs/scheduler-v2-plan.md §3). Only the stable
// task-kind union for now; the full runner/handler types come in a later step.
export type TaskKind = 'full-scrape' | 'pdf-fetch' | 'interval-pull' | 'weather-sync' | 'notify-sync';
