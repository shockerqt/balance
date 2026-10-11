-- Additive: existing binaries and users/domain IDs remain compatible.
-- Creates an empty association table; no email linking or production backfill.
-- Only normal CREATE TABLE locks; no rewrite of existing users. Roll back the
-- binary while retaining this table; identity/cutover mapping is a future action.
CREATE TABLE oidc_user_identities (
    issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
    subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255 AND subject = btrim(subject)),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (issuer, subject)
);
CREATE INDEX oidc_user_identities_user_id_idx ON oidc_user_identities(user_id);
