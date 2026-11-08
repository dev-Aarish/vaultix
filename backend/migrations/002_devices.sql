CREATE TABLE devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_name text NOT NULL,
  public_key text NOT NULL,
  key_fingerprint text NOT NULL,
  attestation_status text NOT NULL DEFAULT 'UNVERIFIED',
  status text NOT NULL DEFAULT 'PENDING',
  proof_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT devices_name_not_blank CHECK (length(btrim(device_name)) > 0),
  CONSTRAINT devices_attestation_status_check
    CHECK (attestation_status IN ('VERIFIED', 'UNVERIFIED', 'FAILED', 'NOT_SUPPORTED')),
  CONSTRAINT devices_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REVOKED'))
);

CREATE UNIQUE INDEX devices_fingerprint_unique ON devices (key_fingerprint);
CREATE INDEX devices_user_idx ON devices (user_id);
CREATE INDEX devices_status_idx ON devices (status);

CREATE TABLE device_challenges (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  challenge text NOT NULL,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_challenges_purpose_check CHECK (purpose IN ('REGISTRATION', 'SESSION'))
);

CREATE INDEX device_challenges_device_idx ON device_challenges (device_id);

ALTER TABLE sessions ADD COLUMN device_id uuid REFERENCES devices (id) ON DELETE SET NULL;
CREATE INDEX sessions_device_idx ON sessions (device_id);
