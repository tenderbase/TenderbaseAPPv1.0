import { Prisma } from "@prisma/client";

/**
 * The weighted tsvector expression. MUST match
 * prisma/migrations/20260908170000_fts_index verbatim, or Postgres falls back
 * to a sequential scan instead of using the GIN index.
 *
 * Weighting: description = A, title = B, organisation = C.
 * Description is highest because 92.9% of tender titles are bare reference
 * codes ("0010572182", "RFX 60000003542") carrying no searchable meaning.
 */
export const SEARCH_EXPR = Prisma.sql`(setweight(to_tsvector('english', coalesce("title", '')), 'B') || setweight(to_tsvector('english', coalesce("description", '')), 'A') || setweight(to_tsvector('english', coalesce("organisation", '')), 'C'))`;
