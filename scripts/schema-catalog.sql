\set ON_ERROR_STOP on

-- Deterministic, data-free catalog used by CI snapshots and production
-- preflight. The SQLx ledger itself is excluded so an untracked production
-- schema can be compared with a freshly migrated ephemeral database.
WITH catalog_records AS (
    SELECT
        1 AS kind_order,
        c.relname AS object_name,
        0 AS item_order,
        format('TABLE|%s', c.relname) AS line
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_sqlx_migrations'

    UNION ALL

    SELECT
        2,
        c.relname,
        a.attnum,
        format(
        'COLUMN|%s|%s|%s|%s|%s|identity=%s|default=%s',
        c.relname,
        a.attnum,
        a.attname,
        pg_catalog.format_type(a.atttypid, a.atttypmod),
        CASE WHEN a.attnotnull THEN 'not-null' ELSE 'nullable' END,
        COALESCE(NULLIF(a.attidentity::text, ''), 'none'),
        replace(replace(COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''), E'\n', ' '), '|', E'\\|')
        )
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d
      ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname <> '_sqlx_migrations'
      AND a.attnum > 0
      AND NOT a.attisdropped

    UNION ALL

    SELECT
        3,
        c.relname,
        0,
        format(
        'CONSTRAINT|%s|%s|%s|%s',
        c.relname,
        con.conname,
        con.contype,
        replace(replace(pg_catalog.pg_get_constraintdef(con.oid, true), E'\n', ' '), '|', E'\\|')
        )
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname <> '_sqlx_migrations'

    UNION ALL

    SELECT
        4,
        table_name.relname,
        0,
        format(
        'INDEX|%s|%s|%s',
        table_name.relname,
        index_name.relname,
        replace(replace(pg_catalog.pg_get_indexdef(index_name.oid), E'\n', ' '), '|', E'\\|')
        )
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class table_name ON table_name.oid = i.indrelid
    JOIN pg_catalog.pg_class index_name ON index_name.oid = i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = table_name.relnamespace
    WHERE n.nspname = 'public'
      AND table_name.relname <> '_sqlx_migrations'

    UNION ALL

    SELECT 5, c.relname, 0, format('SEQUENCE|%s', c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
)
SELECT line
FROM catalog_records
ORDER BY kind_order, object_name, item_order, line;
