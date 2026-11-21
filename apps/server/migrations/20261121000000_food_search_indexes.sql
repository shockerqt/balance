-- Additive search support. A prior binary can keep using this schema.
-- Standard index builds permit reads and block writes until SQLx commits.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

DO $extension_schema$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension e
        JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
    ) THEN
        RAISE EXCEPTION 'food search requires pg_trgm in schema public';
    END IF;
END
$extension_schema$;

-- The migration search_path puts the function in the same schema as meal_templates.
-- Use code point order for the mark range and the database locale for case folding.
CREATE FUNCTION fold_food_search(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    RETURN lower(normalize(
        regexp_replace(normalize(value, NFD) COLLATE pg_catalog."C",
                       U&'[\0300-\036F]', '', 'g'),
        NFC
    ) COLLATE pg_catalog."default");

CREATE INDEX idx_meal_templates_search_name
    ON meal_templates USING gin (fold_food_search(name) public.gin_trgm_ops)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_meal_templates_search_brand
    ON meal_templates USING gin (fold_food_search(COALESCE(details->>'brand', '')) public.gin_trgm_ops)
    WHERE deleted_at IS NULL;
