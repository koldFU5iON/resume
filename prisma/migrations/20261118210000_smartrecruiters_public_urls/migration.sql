-- Job hunter stored SmartRecruiters' API URL (JSON) as the job link.
-- Rewrite to the public posting page; only exact API-URL matches are touched.
UPDATE "DiscoveredJob"
SET "url" = regexp_replace("url", '^https://api\.smartrecruiters\.com/v1/companies/([^/]+)/postings/([^/?#]+)/?$', 'https://jobs.smartrecruiters.com/\1/\2')
WHERE "url" ~ '^https://api\.smartrecruiters\.com/v1/companies/[^/]+/postings/[^/?#]+/?$';

UPDATE "JobApplication"
SET "url" = regexp_replace("url", '^https://api\.smartrecruiters\.com/v1/companies/([^/]+)/postings/([^/?#]+)/?$', 'https://jobs.smartrecruiters.com/\1/\2')
WHERE "url" ~ '^https://api\.smartrecruiters\.com/v1/companies/[^/]+/postings/[^/?#]+/?$';
