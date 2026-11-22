<!-- GENERATED FILE: do not edit manually. Run `make schema-snapshot`. -->
# Balance database schema snapshot

- PostgreSQL major: 17
- Migration head: `20261122010000 mcp mutation receipts log meal checksum=1e1e04d23bf0321b1f3eb227dc1b4b7a23631f3aa85c5f9f9266e032e555e1fc930a6c3727861cb3701c8175ca3befb8`
- Schema fingerprint: `sha256:68aa26651598ba748a23518476a344b0b4ea43ad6554c566bf84c3755a7b3e34`

The active SQLx migrations are the source of truth. This data-free catalog
is generated for human and LLM inspection and is verified by CI.

```text
DATABASE_OWNER|migration-role
SCHEMA|public|owner=pg_database_owner|migration-role-usage=t|migration-role-create=t
TABLE|food_import_rows
TABLE|food_import_sessions
TABLE|mcp_mutation_receipts
TABLE|meal_logs
TABLE|meal_templates
TABLE|oidc_user_identities
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
COLUMN|mcp_mutation_receipts|1|user_id|integer|not-null|identity=none|default=
COLUMN|mcp_mutation_receipts|2|tool_name|text|not-null|identity=none|default=
COLUMN|mcp_mutation_receipts|3|operation_id|uuid|not-null|identity=none|default=
COLUMN|mcp_mutation_receipts|4|schema_version|integer|not-null|identity=none|default=
COLUMN|mcp_mutation_receipts|5|request_intent|jsonb|not-null|identity=none|default=
COLUMN|mcp_mutation_receipts|6|target_state|jsonb|not-null|identity=none|default=
COLUMN|mcp_mutation_receipts|7|created_at|bigint|not-null|identity=none|default=(floor((EXTRACT(epoch FROM clock_timestamp()) * (1000)::numeric)))::bigint
COLUMN|meal_logs|1|id|uuid|not-null|identity=none|default=
COLUMN|meal_logs|2|user_id|integer|not-null|identity=none|default=
COLUMN|meal_logs|3|template_id|uuid|nullable|identity=none|default=
COLUMN|meal_logs|4|name_snapshot|character varying(255)|not-null|identity=none|default=
COLUMN|meal_logs|5|nutrition_snapshot|jsonb|not-null|identity=none|default='{}'::jsonb
COLUMN|meal_logs|6|canonical_quantity|double precision|not-null|identity=none|default=1.0
COLUMN|meal_logs|7|consumed_at|bigint|not-null|identity=none|default=
COLUMN|meal_logs|8|updated_at|bigint|not-null|identity=none|default=
COLUMN|meal_logs|9|deleted_at|bigint|nullable|identity=none|default=
COLUMN|meal_logs|10|source_provider|character varying(32)|nullable|identity=none|default=
COLUMN|meal_logs|11|external_id|character varying(128)|nullable|identity=none|default=
COLUMN|meal_logs|12|entry_snapshot|jsonb|not-null|identity=none|default=
COLUMN|meal_templates|1|id|uuid|not-null|identity=none|default=
COLUMN|meal_templates|2|user_id|integer|nullable|identity=none|default=
COLUMN|meal_templates|3|name|character varying(255)|not-null|identity=none|default=
COLUMN|meal_templates|4|details|jsonb|not-null|identity=none|default='{}'::jsonb
COLUMN|meal_templates|5|updated_at|bigint|not-null|identity=none|default=
COLUMN|meal_templates|6|deleted_at|bigint|nullable|identity=none|default=
COLUMN|meal_templates|7|is_official|boolean|not-null|identity=none|default=false
COLUMN|meal_templates|8|source_provider|character varying(32)|nullable|identity=none|default=
COLUMN|meal_templates|9|external_id|character varying(128)|nullable|identity=none|default=
COLUMN|oidc_user_identities|1|issuer|text|not-null|identity=none|default=
COLUMN|oidc_user_identities|2|subject|text|not-null|identity=none|default=
COLUMN|oidc_user_identities|3|user_id|integer|not-null|identity=none|default=
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
CONSTRAINT|mcp_mutation_receipts|mcp_mutation_receipts_pkey|p|PRIMARY KEY (user_id, tool_name, operation_id)
CONSTRAINT|mcp_mutation_receipts|mcp_mutation_receipts_schema_version_check|c|CHECK (schema_version >= 1)
CONSTRAINT|mcp_mutation_receipts|mcp_mutation_receipts_tool_name_check|c|CHECK (tool_name = ANY (ARRAY['create_food'::text, 'log_food'::text, 'log_meal'::text]))
CONSTRAINT|mcp_mutation_receipts|mcp_mutation_receipts_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|meal_logs|meal_logs_canonical_quantity_positive|c|CHECK (canonical_quantity > 0::double precision)
CONSTRAINT|meal_logs|meal_logs_pkey|p|PRIMARY KEY (id)
CONSTRAINT|meal_logs|meal_logs_template_id_fkey|f|FOREIGN KEY (template_id) REFERENCES meal_templates(id) ON DELETE SET NULL
CONSTRAINT|meal_logs|meal_logs_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|meal_templates|meal_templates_pkey|p|PRIMARY KEY (id)
CONSTRAINT|meal_templates|meal_templates_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
CONSTRAINT|oidc_user_identities|oidc_user_identities_issuer_check|c|CHECK (length(issuer) >= 1 AND length(issuer) <= 2048)
CONSTRAINT|oidc_user_identities|oidc_user_identities_pkey|p|PRIMARY KEY (issuer, subject)
CONSTRAINT|oidc_user_identities|oidc_user_identities_subject_check|c|CHECK (length(subject) >= 1 AND length(subject) <= 255 AND subject = btrim(subject))
CONSTRAINT|oidc_user_identities|oidc_user_identities_user_id_fkey|f|FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
INDEX|mcp_mutation_receipts|mcp_mutation_receipts_pkey|CREATE UNIQUE INDEX mcp_mutation_receipts_pkey ON public.mcp_mutation_receipts USING btree (user_id, tool_name, operation_id)
INDEX|meal_logs|idx_meal_logs_daily|CREATE INDEX idx_meal_logs_daily ON public.meal_logs USING btree (user_id, consumed_at) WHERE (deleted_at IS NULL)
INDEX|meal_logs|idx_meal_logs_import_identity|CREATE UNIQUE INDEX idx_meal_logs_import_identity ON public.meal_logs USING btree (user_id, source_provider, external_id) WHERE ((source_provider IS NOT NULL) AND (external_id IS NOT NULL))
INDEX|meal_logs|idx_meal_logs_sync|CREATE INDEX idx_meal_logs_sync ON public.meal_logs USING btree (user_id, updated_at, id)
INDEX|meal_logs|meal_logs_pkey|CREATE UNIQUE INDEX meal_logs_pkey ON public.meal_logs USING btree (id)
INDEX|meal_templates|idx_meal_templates_import_identity|CREATE UNIQUE INDEX idx_meal_templates_import_identity ON public.meal_templates USING btree (user_id, source_provider, external_id) WHERE ((source_provider IS NOT NULL) AND (external_id IS NOT NULL))
INDEX|meal_templates|idx_meal_templates_official|CREATE INDEX idx_meal_templates_official ON public.meal_templates USING btree (is_official, deleted_at)
INDEX|meal_templates|idx_meal_templates_search_brand|CREATE INDEX idx_meal_templates_search_brand ON public.meal_templates USING gin (fold_food_search(COALESCE((details ->> 'brand'::text), ''::text)) gin_trgm_ops) WHERE (deleted_at IS NULL)
INDEX|meal_templates|idx_meal_templates_search_name|CREATE INDEX idx_meal_templates_search_name ON public.meal_templates USING gin (fold_food_search((name)::text) gin_trgm_ops) WHERE (deleted_at IS NULL)
INDEX|meal_templates|idx_meal_templates_sync|CREATE INDEX idx_meal_templates_sync ON public.meal_templates USING btree (user_id, updated_at, id)
INDEX|meal_templates|meal_templates_pkey|CREATE UNIQUE INDEX meal_templates_pkey ON public.meal_templates USING btree (id)
INDEX|oidc_user_identities|oidc_user_identities_pkey|CREATE UNIQUE INDEX oidc_user_identities_pkey ON public.oidc_user_identities USING btree (issuer, subject)
INDEX|oidc_user_identities|oidc_user_identities_user_id_idx|CREATE INDEX oidc_user_identities_user_id_idx ON public.oidc_user_identities USING btree (user_id)
INDEX|user_preferences|idx_user_preferences_sync|CREATE INDEX idx_user_preferences_sync ON public.user_preferences USING btree (id, updated_at)
INDEX|user_preferences|user_preferences_pkey|CREATE UNIQUE INDEX user_preferences_pkey ON public.user_preferences USING btree (id)
INDEX|users|users_email_key|CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)
INDEX|users|users_pkey|CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)
INDEX|weight_logs|idx_weight_logs_sync|CREATE INDEX idx_weight_logs_sync ON public.weight_logs USING btree (user_id, updated_at, measured_on)
INDEX|weight_logs|weight_logs_pkey|CREATE UNIQUE INDEX weight_logs_pkey ON public.weight_logs USING btree (user_id, measured_on)
OWNER|TABLE|food_import_rows|migration-role
OWNER|TABLE|food_import_sessions|migration-role
OWNER|TABLE|mcp_mutation_receipts|migration-role
OWNER|TABLE|meal_logs|migration-role
OWNER|TABLE|meal_templates|migration-role
OWNER|TABLE|oidc_user_identities|migration-role
OWNER|TABLE|user_preferences|migration-role
OWNER|TABLE|users|migration-role
OWNER|SEQUENCE|users_id_seq|migration-role
OWNER|TABLE|weight_logs|migration-role
SEQUENCE|users_id_seq
```
