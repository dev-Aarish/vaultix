import type { Pool } from 'pg';
import type { AppConfig } from './config';
import { createLogger, type Logger } from './lib/logger';
import { AuditService } from './services/audit';
import { DeviceService } from './services/devices';
import { InvitationService } from './services/invitations';
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
}

export function createContext(config: AppConfig, pool: Pool, logger?: Logger): AppContext {
  const log = logger ?? createLogger(config.logLevel);
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
  };
}
