-- Existing rows predate DiscoveredJob.source. Company-watch roles are the only
-- records that need changing from the initial BOARD default.
UPDATE "DiscoveredJob"
SET "source" = 'COMPANY'
WHERE "watchId" IS NOT NULL;

-- Scout triage is meaningful only for Scout submissions. Keep all existing
-- discovery records terminal so they do not look like pending Scout work.
UPDATE "DiscoveredJob"
SET "triageStatus" = 'COMPLETE'
WHERE "source" <> 'SCOUT';
