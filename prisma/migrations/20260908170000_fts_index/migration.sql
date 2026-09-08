-- Full-text search index.
--
-- Weighting is deliberate: 92.9% of tender titles are bare reference codes
-- ("0010572182", "RFX 60000003542"), so the DESCRIPTION carries the meaning
-- and is weighted highest (A). Title is B, organisation C.
--
-- Built as an EXPRESSION index rather than a generated tsvector column so
-- Prisma's schema diffing never sees it as drift and tries to drop it.
-- Queries must repeat this exact expression to use the index.

CREATE INDEX "Tender_search_idx" ON "Tender" USING GIN (
  (
    setweight(to_tsvector('english', coalesce("title", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("organisation", '')), 'C')
  )
);
