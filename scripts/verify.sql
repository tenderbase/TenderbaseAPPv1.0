\echo '=== TOTALS ==='
SELECT count(*) AS tenders FROM "Tender";
SELECT count(*) AS documents FROM "TenderDocument";
SELECT count(*) AS runs FROM "ScraperRun";

\echo ''
\echo '=== EXPIRING SOON (active + isOpportunity + closing within 7d) ==='
SELECT count(*) AS expiring_soon FROM "Tender"
WHERE "status" = 'active'
  AND "isOpportunity"
  AND "closingDate" >= now()
  AND "closingDate" <= now() + interval '7 days';

\echo ''
\echo '=== TOP CATEGORIES (app currently shows 97% "Other") ==='
SELECT coalesce("category",'?') AS category, count(*) FROM "Tender"
GROUP BY 1 ORDER BY 2 DESC LIMIT 8;

\echo ''
\echo '=== PROVINCES ==='
SELECT coalesce("province",'?') AS province, count(*) FROM "Tender"
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== FULL-TEXT SEARCH: "catering" ==='
SELECT count(*) AS catering_matches FROM "Tender"
WHERE (setweight(to_tsvector('english', coalesce("title",'')),'B') ||
       setweight(to_tsvector('english', coalesce("description",'')),'A') ||
       setweight(to_tsvector('english', coalesce("organisation",'')),'C'))
      @@ websearch_to_tsquery('english','catering');

\echo ''
\echo '=== FULL-TEXT: stemming check — does "catering" match "CATERERS"? ==='
SELECT "tenderNumber", left(coalesce("description",''),60) AS description FROM "Tender"
WHERE (setweight(to_tsvector('english', coalesce("title",'')),'B') ||
       setweight(to_tsvector('english', coalesce("description",'')),'A') ||
       setweight(to_tsvector('english', coalesce("organisation",'')),'C'))
      @@ websearch_to_tsquery('english','catering')
  AND coalesce("description",'') !~* 'catering'
LIMIT 5;

\echo ''
\echo '=== EXPLAIN: prove the GIN index is used ==='
EXPLAIN (COSTS OFF)
SELECT "id" FROM "Tender"
WHERE (setweight(to_tsvector('english', coalesce("title",'')),'B') ||
       setweight(to_tsvector('english', coalesce("description",'')),'A') ||
       setweight(to_tsvector('english', coalesce("organisation",'')),'C'))
      @@ websearch_to_tsquery('english','catering');

\echo ''
\echo '=== KWAZULU-NATAL + food/catering (the Durban caterer case) ==='
SELECT count(*) AS kzn_food FROM "Tender"
WHERE "province" = 'KwaZulu-Natal'
  AND ("category" LIKE 'Food and beverage%'
       OR (setweight(to_tsvector('english', coalesce("title",'')),'B') ||
           setweight(to_tsvector('english', coalesce("description",'')),'A') ||
           setweight(to_tsvector('english', coalesce("organisation",'')),'C'))
          @@ websearch_to_tsquery('english','catering OR canteen OR meals'));
