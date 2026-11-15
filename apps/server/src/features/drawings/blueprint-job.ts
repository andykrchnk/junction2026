export type BlueprintJobLease = Readonly<{ runId: string; page: number; index: number; lease: string }>;

// Task positions are append-only within a run. Match the run and page as well as
// its token, so replaced runs and expired workers cannot save late results.
export function blueprintJobFilter(job: BlueprintJobLease) {
    const root = `processingJob.tasks.${job.index}`;
    return {
        'processingJob.id': job.runId,
        [`${root}.page`]: job.page,
        [`${root}.status`]: 'running',
        [`${root}.lease`]: job.lease,
        [`${root}.leaseUntil`]: { $gt: new Date() },
    };
}
