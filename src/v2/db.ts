import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: config.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

export async function ensureSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS provinces (
        id text PRIMARY KEY,
        name text NOT NULL UNIQUE,
        code text UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS municipalities (
        id text PRIMARY KEY,
        code text NOT NULL UNIQUE,
        name text NOT NULL,
        province_id text REFERENCES provinces(id) ON DELETE SET NULL,
        type text NOT NULL DEFAULT 'LOCAL_MUNICIPALITY',
        website_url text,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS organizations (
        id text PRIMARY KEY,
        name text NOT NULL,
        external_id text,
        source text NOT NULL DEFAULT 'OCDS',
        province_id text REFERENCES provinces(id) ON DELETE SET NULL,
        municipality_id text REFERENCES municipalities(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source, external_id)
      );

      CREATE TABLE IF NOT EXISTS tenders (
        id text PRIMARY KEY,
        source text NOT NULL,
        source_url text,
        ocid text,
        release_id text,
        tender_number text,
        procurement_type text NOT NULL DEFAULT 'TENDER',
        municipality_id text REFERENCES municipalities(id) ON DELETE SET NULL,
        buyer_organization_id text REFERENCES organizations(id) ON DELETE SET NULL,
        title text,
        description text,
        category text,
        province text,
        location text,
        value_cents bigint,
        currency text,
        published_date timestamptz,
        closing_date timestamptz,
        status text,
        contact_name text,
        contact_email text,
        contact_phone text,
        cidb_grade text,
        cidb_grade_raw text,
        is_opportunity boolean NOT NULL DEFAULT true,
        content_hash text NOT NULL,
        raw_release jsonb,
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source, ocid, release_id)
      );

      CREATE TABLE IF NOT EXISTS tender_documents (
        id text PRIMARY KEY,
        tender_id text NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
        name text,
        url text NOT NULL,
        file_type text,
        is_addendum boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS ingestion_runs (
        id text PRIMARY KEY,
        source text NOT NULL,
        status text NOT NULL DEFAULT 'RUNNING',
        mode text NOT NULL DEFAULT 'incremental',
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        fetched_count integer NOT NULL DEFAULT 0,
        inserted_count integer NOT NULL DEFAULT 0,
        updated_count integer NOT NULL DEFAULT 0,
        unchanged_count integer NOT NULL DEFAULT 0,
        error_count integer NOT NULL DEFAULT 0,
        error_message text
      );

      CREATE INDEX IF NOT EXISTS tenders_closing_date_idx ON tenders (closing_date);
      CREATE INDEX IF NOT EXISTS tenders_published_date_idx ON tenders (published_date);
      CREATE INDEX IF NOT EXISTS tenders_status_idx ON tenders (status);
      CREATE INDEX IF NOT EXISTS tenders_province_category_idx ON tenders (province, category);
      CREATE INDEX IF NOT EXISTS tenders_municipality_type_idx ON tenders (municipality_id, procurement_type);
      CREATE INDEX IF NOT EXISTS tenders_title_search_idx ON tenders USING gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));
      CREATE INDEX IF NOT EXISTS tender_documents_tender_idx ON tender_documents (tender_id);
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
