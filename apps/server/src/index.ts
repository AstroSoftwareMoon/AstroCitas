import { loadConfig } from './config';
import { buildServer } from './server';
import { plugins } from './plugins';

const cfg = loadConfig();
const srv = await buildServer(cfg, { plugins });
await srv.fastify.listen({ port: cfg.port, host: cfg.host });
srv.app.log.info({ version: cfg.version, db: srv.app.store.dialect, url: cfg.publicUrl }, 'AstroCitas server listo');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    srv.app.log.info(`${sig}: cerrando…`);
    await srv.close();
    process.exit(0);
  });
}
