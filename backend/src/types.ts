import type { SessionRow, UserRow } from './db/rows';

export interface RequestAuth {
  user: UserRow;
  session: SessionRow;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: RequestAuth;
    }
  }
}

export {};
