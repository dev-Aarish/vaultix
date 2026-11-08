import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';
import { createContext } from './context';
import { createPool } from './db/pool';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  const ctx = createContext(config, pool);

  await pool.query('SELECT 1');

  const app = createApp(ctx);
  const server = app.listen(config.port, () => {
    ctx.logger.info({ port: config.port, env: config.env }, 'vaultix backend listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.logger.info({ signal }, 'shutting down');
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
