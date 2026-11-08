CREATE TABLE folders (
  id uuid PRIMARY KEY,
  parent_folder_id uuid REFERENCES folders (id) ON DELETE RESTRICT,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folders_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT folders_status_check CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE INDEX folders_parent_idx ON folders (parent_folder_id);
CREATE INDEX folders_status_idx ON folders (status);

CREATE TABLE files (
  id uuid PRIMARY KEY,
  folder_id uuid REFERENCES folders (id) ON DELETE RESTRICT,
  original_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL,
  checksum text NOT NULL,
  storage_object_key text NOT NULL UNIQUE,
  encryption_algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  encryption_iv text NOT NULL,
  encryption_auth_tag text NOT NULL,
  encryption_key_reference text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT files_name_not_blank CHECK (length(btrim(original_name)) > 0),
  CONSTRAINT files_size_check CHECK (size_bytes >= 0),
  CONSTRAINT files_status_check CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE INDEX files_folder_idx ON files (folder_id);
CREATE INDEX files_status_idx ON files (status);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  actions text[] NOT NULL,
  device_ids uuid[],
  status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT permissions_subject_type_check CHECK (subject_type IN ('USER', 'DEVICE')),
  CONSTRAINT permissions_resource_type_check CHECK (resource_type IN ('FILE', 'FOLDER')),
  CONSTRAINT permissions_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT permissions_actions_check
    CHECK (cardinality(actions) > 0 AND actions <@ ARRAY['VIEW', 'DOWNLOAD', 'EDIT']::text[]),
  CONSTRAINT permissions_device_subject_check
    CHECK (subject_type <> 'DEVICE' OR device_ids IS NULL)
);

CREATE INDEX permissions_subject_idx ON permissions (subject_type, subject_id);
CREATE INDEX permissions_resource_idx ON permissions (resource_type, resource_id);
CREATE UNIQUE INDEX permissions_active_unique
  ON permissions (subject_type, subject_id, resource_type, resource_id)
  WHERE status = 'ACTIVE';
