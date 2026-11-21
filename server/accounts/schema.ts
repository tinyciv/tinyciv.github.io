import { TELEMETRY_SCHEMA } from '../telemetry/schema';

export const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS accounts;
CREATE TABLE IF NOT EXISTS accounts.users (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9_.-]{1,40}$'),
  email text UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  password_hash text NOT NULL CHECK (password_hash ~ '^scrypt\\$131072\\$8\\$1\\$[a-f0-9]{32}\\$[a-f0-9]{64}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE accounts.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE accounts.users ADD COLUMN IF NOT EXISTS username text CHECK (username ~ '^[A-Za-z0-9_.-]{1,40}$');
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON accounts.users (lower(username));
CREATE TABLE IF NOT EXISTS accounts.game_saves (
  user_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  id varchar(36) NOT NULL,
  name varchar(80) NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  game_time double precision NOT NULL,
  seed varchar(256) NOT NULL,
  civilization varchar(100) NOT NULL,
  payload bytea NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS game_saves_recent ON accounts.game_saves (user_id, saved_at DESC, id);
CREATE TABLE IF NOT EXISTS accounts.user_data (
  user_id uuid PRIMARY KEY REFERENCES accounts.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 16384),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts.sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON accounts.sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_user ON accounts.sessions(user_id);
CREATE TABLE IF NOT EXISTS accounts.auth_limits (
  key char(64) PRIMARY KEY,
  attempts integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_limits_expiry ON accounts.auth_limits(reset_at);
CREATE TABLE IF NOT EXISTS accounts.feedback (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES accounts.users(id) ON DELETE SET NULL,
  visitor_id varchar(80) NOT NULL CHECK (visitor_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 4000 AND octet_length(message) <= 16000),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_created ON accounts.feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_user ON accounts.feedback(user_id, created_at DESC);
${TELEMETRY_SCHEMA}
REVOKE ALL ON SCHEMA accounts FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA accounts FROM PUBLIC;
GRANT USAGE ON SCHEMA accounts TO tinyciv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA accounts TO tinyciv_app;
`;
