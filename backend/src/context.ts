import type { Pool } from 'pg';
import type { AppConfig } from './config';
import { createLogger, type Logger } from './lib/logger';
import { AuditService } from './services/audit';
import { AuthorizationService } from './services/authorization';
import { DeviceService } from './services/devices';
import { FileCryptoService } from './services/file-crypto';
import { LocalFileStorage } from './services/file-storage';
import { FileService } from './services/files';
import { FolderService } from './services/folders';
import { InvitationService } from './services/invitations';
import { PermissionService } from './services/permissions';
import { RegistrationService } from './services/registration';
import { SessionService } from './services/sessions';
import { UserService } from './services/users';

export interface AppContext {
  config: AppConfig;
  pool: Pool;
  logger: Logger;
  audit: AuditService;
  users: UserService;
  sessions: SessionService;
  invitations: InvitationService;
  registration: RegistrationService;
  devices: DeviceService;
  folders: FolderService;
  files: FileService;
  permissions: PermissionService;
  authorization: AuthorizationService;
}

export function createContext(config: AppConfig, pool: Pool, logger?: Logger): AppContext {
  const log = logger ?? createLogger(config.logLevel);
  const folders = new FolderService(pool);
  return {
    config,
    pool,
    logger: log,
    audit: new AuditService(pool, log),
    users: new UserService(pool),
    sessions: new SessionService(pool, config),
    invitations: new InvitationService(pool, config),
    registration: new RegistrationService(pool, config),
    devices: new DeviceService(pool),
    folders,
    files: new FileService(
      pool,
      new LocalFileStorage(config.fileStorageDir),
      new FileCryptoService(config),
      folders,
    ),
    permissions: new PermissionService(pool),
    authorization: new AuthorizationService(pool),
  };
}
