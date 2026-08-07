-- Repair food_versions IDs for installations created before the sequence default.
-- Safe on populated databases: the next value is set after the current maximum ID.
CREATE SEQUENCE IF NOT EXISTS food_versions_id_seq AS INTEGER;
DO $migration$
DECLARE
    owner_name NAME;
BEGIN
    SELECT pg_get_userbyid(relowner) INTO owner_name
    FROM pg_class
    WHERE oid = 'public.food_versions'::regclass;
    EXECUTE format('ALTER SEQUENCE public.food_versions_id_seq OWNER TO %I', owner_name);
END
$migration$;
ALTER SEQUENCE food_versions_id_seq OWNED BY food_versions.id;
ALTER TABLE food_versions
    ALTER COLUMN id SET DEFAULT nextval('food_versions_id_seq'::regclass);
SELECT setval(
    'food_versions_id_seq',
    COALESCE((SELECT MAX(id) FROM food_versions), 0) + 1,
    false
);
