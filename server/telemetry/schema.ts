export const TELEMETRY_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE TABLE IF NOT EXISTS telemetry.events (
  id uuid PRIMARY KEY,
  queue_order bigint GENERATED ALWAYS AS IDENTITY,
  received_at timestamptz NOT NULL DEFAULT now(),
  visitor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  kind text NOT NULL,
  world_type text NOT NULL,
  world_preset text NOT NULL,
  landform text NOT NULL,
  scenario text NOT NULL,
  mode text NOT NULL,
  build text NOT NULL,
  value double precision NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  message text,
  payload jsonb NOT NULL,
  ga_state text NOT NULL DEFAULT 'pending' CHECK (ga_state IN ('pending','sent','rejected','expired')),
  ga_attempts integer NOT NULL DEFAULT 0,
  ga_retry_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telemetry_received ON telemetry.events(received_at);
CREATE INDEX IF NOT EXISTS telemetry_session ON telemetry.events(session_id, received_at);
CREATE INDEX IF NOT EXISTS telemetry_ga_pending ON telemetry.events(queue_order) WHERE ga_state='pending';
CREATE INDEX IF NOT EXISTS telemetry_usage ON telemetry.events(kind, received_at);
REVOKE ALL ON SCHEMA telemetry FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA telemetry FROM PUBLIC;
GRANT USAGE ON SCHEMA telemetry TO tinyciv_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA telemetry TO tinyciv_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA telemetry TO tinyciv_app;
`;
