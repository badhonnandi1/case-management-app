-- Local development may have applied an earlier version of migration 0001.
-- Production enforcement uses a D1 batch transaction in WorkerSecurityStore.
DROP TRIGGER IF EXISTS reserve_answer_limits;
