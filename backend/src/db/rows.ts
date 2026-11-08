export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type AuditResult = 'SUCCESS' | 'DENIED';
export type DeviceStatus = 'PENDING' | 'APPROVED' | 'REVOKED';
export type DeviceAttestationStatus = 'VERIFIED' | 'UNVERIFIED' | 'FAILED' | 'NOT_SUPPORTED';
export type DeviceChallengePurpose = 'REGISTRATION' | 'SESSION';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InvitationRow {
  id: string;
  email: string;
  token_hash: string;
  role: UserRole;
  created_by: string | null;
  expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_activity_at: Date;
  revoked_at: Date | null;
  ip_address: string | null;
  user_agent: string | null;
  device_id: string | null;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  device_name: string;
  public_key: string;
  key_fingerprint: string;
  attestation_status: DeviceAttestationStatus;
  status: DeviceStatus;
  proof_verified_at: Date | null;
  created_at: Date;
  last_seen_at: Date | null;
  revoked_at: Date | null;
}

export interface DeviceChallengeRow {
  id: string;
  device_id: string;
  challenge: string;
  purpose: DeviceChallengePurpose;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface AuditEventRow {
  id: string;
  actor_user_id: string | null;
  device_id: string | null;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  result: AuditResult;
  reason_code: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}
