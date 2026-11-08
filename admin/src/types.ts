export type UserRole = 'ADMIN' | 'USER';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type DeviceStatus = 'PENDING' | 'APPROVED' | 'REVOKED';
export type AttestationStatus = 'VERIFIED' | 'UNVERIFIED' | 'FAILED' | 'NOT_SUPPORTED';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  userId: string;
  deviceName: string;
  keyFingerprint: string;
  attestationStatus: AttestationStatus;
  status: DeviceStatus;
  proofVerifiedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  userEmail?: string;
  userName?: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  createdBy: string | null;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: { total: number; limit: number; offset: number };
}

export interface Single<T> {
  data: T;
}
