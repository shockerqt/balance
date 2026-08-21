<!-- GENERATED FILE: do not edit manually. Run `make schema-snapshot`. -->
# Balance database schema snapshot

- PostgreSQL major: 17
- Migration head: `20260821000000 canonical baseline checksum=27bcd81f0f09c4260ddc099bbe164800de86fdd89b411158fd5cd94cf7f3b8346e7be7dd4f0ff2d7c43865a995823221`
- Schema fingerprint: `sha256:638293cc9edbffc58be56cb5ea03b5e599f4285063671afb76c4eba1b7d63c8a`

The active SQLx migrations are the source of truth. This data-free catalog
is generated for human and LLM inspection and is verified by CI.

```text
DATABASE_OWNER|migration-role
SCHEMA|public|owner=pg_database_owner|migration-role-usage=t|migration-role-create=t
TABLE|food_import_rows
TABLE|food_import_sessions
TABLE|meal_logs
TABLE|meal_templates
TABLE|user_preferences
TABLE|users
TABLE|weight_logs
COLUMN|food_import_rows|1|session_id|uuid|not-null|identity=none|default=
COLUMN|food_import_rows|2|row_index|integer|not-null|identity=none|default=
COLUMN|food_import_rows|3|payload|jsonb|not-null|identity=none|default=
COLUMN|food_import_sessions|1|id|uuid|not-null|identity=none|default=
COLUMN|food_import_sessions|2|user_id|integer|not-null|identity=none|default=
COLUMN|food_import_sessions|3|provider|character varying(32)|not-null|identity=none|default=
COLUMN|food_import_sessions|4|file_fingerprint|character varying(128)|not-null|identity=none|default=
COLUMN|food_import_sessions|5|expected_rows|integer|not-null|identity=none|default=
COLUMN|food_import_sessions|6|templates|jsonb|not-null|identity=none|default='[]'::jsonb
COLUMN|food_import_sessions|7|status|character varying(16)|not-null|identity=none|default=
COLUMN|food_import_sessions|8|summary|jsonb|nullable|identity=none|default=
COLUMN|food_import_sessions|9|created_at|timestamp with time zone|not-null|identity=none|default=clock_timestamp()
COLUMN|food_import_sessions|10|committed_at|timestamp with time zone|nullable|identity=none|default=
COLUMN|meal_logs|1|id|uuid|not-null|identity=none|default=
COLUMN|meal_logs|2|user_id|integer|not-null|identity=none|default=
COLUMN|meal_logs|3|template_id|uuid|nullable|identity=none|default=
COLUMN|meal_logs|4|name_snapshot|character varying(255)|not-null|identity=none|default=
COLUMN|meal_logs|5|nutrition_snapshot|jsonb|not-null|identity=none|default='{}'::jsonb
COLUMN|meal_logs|6|quantity|double precision|not-null|identity=none|default=1.0
COLUMN|meal_logs|7|consumed_at|bigint|not-null|identity=none|default=
COLUMN|meal_logs|8|updated_at|bigint|not-null|identity=none|default=
COLUMN|meal_logs|9|deleted_at|bigint|nullable|identity=none|default=
COLUMN|meal_logs|10|source_provider|character varying(32)|nullable|identity=none|default=
COLUMN|meal_logs|11|external_id|character varying(128)|nullable|identity=none|default=
COLUMN|meal_templates|1|id|uuid|not-null|identity=none|default=
COLUMN|meal_templates|2|user_id|integer|nullable|identity=none|default=
COLUMN|meal_templates|3|name|character varying(255)|not-null|identity=none|default=
COLUMN|meal_templates|4|details|jsonb|not-null|identity=none|default='{}'::jsonb
COLUMN|meal_templates|5|updated_at|bigint|not-null|identity=none|default=
COLUMN|meal_templates|6|deleted_at|bigint|nullable|identity=none|default=
COLUMN|meal_templates|7|is_official|boolean|not-null|identity=none|default=false
COLUMN|meal_templates|8|source_provider|character varying(32)|nullable|identity=none|default=
COLUMN|meal_templates|9|external_id|character varying(128)|nullable|identity=none|default=
COLUMN|user_preferences|1|id|integer|not-null|identity=none|default=
COLUMN|user_preferences|2|preferences|jsonb|not-null|identity=none|default='{}'::jsonb
COLUMN|user_preferences|3|updated_at|bigint|not-null|identity=none|default=
COLUMN|user_preferences|4|deleted_at|bigint|nullable|identity=none|default=
COLUMN|users|1|id|integer|not-null|identity=none|default=nextval('users_id_seq'::regclass)
COLUMN|users|2|email|text|not-null|identity=none|default=
COLUMN|users|3|name|text|nullable|identity=none|default=
COLUMN|users|4|created_at|timestamp without time zone|nullable|identity=none|default=now()
COLUMN|users|5|family_name|text|nullable|identity=none|default=
COLUMN|users|6|given_name|text|nullable|identity=none|default=
COLUMN|users|7|picture|text|nullable|identity=none|default=
COLUMN|weight_logs|1|user_id|integer|not-null|identity=none|default=
COLUMN|weight_logs|2|measured_on|date|not-null|identity=none|default=
COLUMN|weight_logs|3|weight_grams|integer|not-null|identity=none|default=
COLUMN|weight_logs|4|updated_at|bigint|not-null|identity=none|default=
COLUMN|weight_logs|5|deleted_at|bigint|nullable|identity=none|default=
CONSTRAINT|food_import_rows|food_import_rows_pkey|p|PRIMARY KEY (session_id, row_index)
CONSTRAINT|food_import_rows|food_import_rows_row_index_check|c|CHECK (row_index >= 2)
CONSTRAINT|food_import_rows|food_import_rows_session_id_fkey|f|FOREIGN KEY (session_id) REFERENCES food_import_sessions(id) ON DELETE CASCADE
CONSTRAINT|food_import_sessions|food_import_sessions_expected_rows_check|c|CHECK (expected_rows >= 1 AND expected_rows <= 100000)
CONSTRAINT|food_import_sessions|food_import_sessions_pkey|p|PRIMARY KEY (id)
CONSTRAINT|food_import_sessions|food_import_sessions_status_check|c|CHECK (status::text = ANY (ARRAY['staged'::character varying, 'committed'::character varying, 'cancelled'::character varying]::text[]))
CONSTRAINT|food_import_sessions|food_import_sessions_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|meal_logs|meal_logs_pkey|p|PRIMARY KEY (id)
CONSTRAINT|meal_logs|meal_logs_template_id_fkey|f|FOREIGN KEY (template_id) REFERENCES meal_templates(id) ON DELETE SET NULL
CONSTRAINT|meal_logs|meal_logs_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|meal_templates|meal_templates_pkey|p|PRIMARY KEY (id)
CONSTRAINT|meal_templates|meal_templates_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|user_preferences|user_preferences_id_fkey|f|FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|user_preferences|user_preferences_pkey|p|PRIMARY KEY (id)
CONSTRAINT|users|users_email_key|u|UNIQUE (email)
CONSTRAINT|users|users_pkey|p|PRIMARY KEY (id)
CONSTRAINT|weight_logs|weight_logs_pkey|p|PRIMARY KEY (user_id, measured_on)
CONSTRAINT|weight_logs|weight_logs_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|weight_logs|weight_logs_weight_grams_check|c|CHECK (weight_grams >= 1000 AND weight_grams <= 500000 AND (weight_grams % 100) = 0)
INDEX|food_import_rows|food_import_rows_pkey|CREATE UNIQUE INDEX food_import_rows_pkey ON public.food_import_rows USING btree (session_id, row_index)
INDEX|food_import_sessions|food_import_sessions_pkey|CREATE UNIQUE INDEX food_import_sessions_pkey ON public.food_import_sessions USING btree (id)
INDEX|food_import_sessions|idx_food_import_sessions_owner|CREATE INDEX idx_food_import_sessions_owner ON public.food_import_sessions USING btree (user_id, created_at DESC)
INDEX|meal_logs|idx_meal_logs_daily|CREATE INDEX idx_meal_logs_daily ON public.meal_logs USING btree (user_id, consumed_at) WHERE (deleted_at IS NULL)
INDEX|meal_logs|idx_meal_logs_import_identity|CREATE UNIQUE INDEX idx_meal_logs_import_identity ON public.meal_logs USING btree (user_id, source_provider, external_id) WHERE ((source_provider IS NOT NULL) AND (external_id IS NOT NULL))
INDEX|meal_logs|idx_meal_logs_sync|CREATE INDEX idx_meal_logs_sync ON public.meal_logs USING btree (user_id, updated_at, id)
INDEX|meal_logs|meal_logs_pkey|CREATE UNIQUE INDEX meal_logs_pkey ON public.meal_logs USING btree (id)
INDEX|meal_templates|idx_meal_templates_import_identity|CREATE UNIQUE INDEX idx_meal_templates_import_identity ON public.meal_templates USING btree (user_id, source_provider, external_id) WHERE ((source_provider IS NOT NULL) AND (external_id IS NOT NULL))
INDEX|meal_templates|idx_meal_templates_official|CREATE INDEX idx_meal_templates_official ON public.meal_templates USING btree (is_official, deleted_at)
INDEX|meal_templates|idx_meal_templates_sync|CREATE INDEX idx_meal_templates_sync ON public.meal_templates USING btree (user_id, updated_at, id)
INDEX|meal_templates|meal_templates_pkey|CREATE UNIQUE INDEX meal_templates_pkey ON public.meal_templates USING btree (id)
INDEX|user_preferences|idx_user_preferences_sync|CREATE INDEX idx_user_preferences_sync ON public.user_preferences USING btree (id, updated_at)
INDEX|user_preferences|user_preferences_pkey|CREATE UNIQUE INDEX user_preferences_pkey ON public.user_preferences USING btree (id)
INDEX|users|users_email_key|CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)
INDEX|users|users_pkey|CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)
INDEX|weight_logs|idx_weight_logs_sync|CREATE INDEX idx_weight_logs_sync ON public.weight_logs USING btree (user_id, updated_at, measured_on)
INDEX|weight_logs|weight_logs_pkey|CREATE UNIQUE INDEX weight_logs_pkey ON public.weight_logs USING btree (user_id, measured_on)
OWNER|TABLE|food_import_rows|migration-role
OWNER|TABLE|food_import_sessions|migration-role
OWNER|TABLE|meal_logs|migration-role
OWNER|TABLE|meal_templates|migration-role
OWNER|TABLE|user_preferences|migration-role
OWNER|TABLE|users|migration-role
OWNER|SEQUENCE|users_id_seq|migration-role
OWNER|TABLE|weight_logs|migration-role
SEQUENCE|users_id_seq
```
