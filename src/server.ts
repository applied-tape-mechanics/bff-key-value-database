import { buildApp } from './app.ts';

const disableBackend = ['true', '1', 'yes'].includes((process.env.DISABLE_BACKEND ?? 'false').toLowerCase());
const port = Number(process.env.PORT ?? 8000);

const app = await buildApp({ disableBackend, logger: true });

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
