/**
 * Fastify REST API, OpenAPI docs and Web UI for the Brainfuck Key-Value Database.
 */

import { readFileSync } from 'node:fs';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { BrainfuckKVDB, KEY_MAX_LEN, TAPE_SIZE, VALUE_MAX_LEN } from './engine.ts';

export const APP_ID = 'bff-key-value-database';
export const VERSION = '1.0.0';

export interface AppOptions {
  disableBackend?: boolean;
  db?: BrainfuckKVDB;
  logger?: boolean;
}

interface SetBody {
  key: string;
  value: string;
}

const errorSchema = {
  type: 'object',
  properties: { detail: { type: 'string' } },
} as const;

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const disableBackend = options.disableBackend ?? false;
  const db = options.db ?? new BrainfuckKVDB();
  const indexHtml = readFileSync(new URL('./index.html', import.meta.url), 'utf-8');

  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    void reply.status(status).send({ detail: error.message });
  });

  if (!disableBackend) {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'Brainfuck Key-Value Database (bff-key-value-database)',
          description:
            'A key-value store whose storage medium is a Brainfuck memory tape. Keys are hashed by a pure-BF program; data is stored in open-addressed tape buckets.',
          version: VERSION,
        },
      },
    });
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
    app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }

  const guard = () => {
    if (disableBackend) {
      throw Object.assign(new Error('Backend API processing is disabled (DISABLE_BACKEND=true).'), {
        statusCode: 503,
      });
    }
  };

  app.get(
    '/health',
    {
      schema: {
        summary: 'Health status',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              engine: { type: 'string' },
              tape_cells: { type: 'integer' },
              backend_enabled: { type: 'boolean' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'UP',
      engine: 'brainfuck',
      tape_cells: TAPE_SIZE,
      backend_enabled: !disableBackend,
    }),
  );

  app.get(
    '/bf',
    {
      schema: {
        summary: 'Inspect Brainfuck hash code',
      },
    },
    async () => ({
      title: 'Brainfuck Key Hasher (hash.bf)',
      description: 'Calculates 8-bit hash bucket index (0-255) via wrapping cell addition',
      instruction_count: db.bfHashSource.length,
      code: db.bfHashSource,
    }),
  );

  const renderHtml = () => indexHtml.replace('__BF_HASH__', () => JSON.stringify(db.bfHashSource));

  app.get('/ui', { schema: { hide: true } }, async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(renderHtml()),
  );

  app.get('/', { schema: { hide: true } }, async (req, reply) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/html') && !accept.includes('application/json')) {
      return reply.type('text/html; charset=utf-8').send(renderHtml());
    }
    return {
      service: 'Brainfuck Key-Value Database',
      version: VERSION,
      engine: 'brainfuck-64k-tape',
      endpoints: {
        'GET    /ui': 'Interactive Web UI dashboard',
        'PUT    /db': 'Set a key-value pair',
        'GET    /db': 'List all entries',
        'GET    /db/{key}': 'Retrieve a value',
        'DELETE /db/{key}': 'Delete a key',
        'POST   /clear': 'Wipe all entries',
        'GET    /stats': 'Database statistics',
        'GET    /health': 'Health check',
        'GET    /tape': 'Debug: raw tape dump',
        'GET    /bf': 'Inspect Brainfuck hash code',
      },
    };
  });

  app.put<{ Body: SetBody }>(
    '/db',
    {
      schema: {
        summary: 'Insert or update key-value pair',
        body: {
          type: 'object',
          required: ['key', 'value'],
          properties: {
            key: { type: 'string', minLength: 1, maxLength: KEY_MAX_LEN },
            value: { type: 'string', maxLength: VALUE_MAX_LEN },
          },
        },
      },
    },
    async (req, reply) => {
      guard();
      const { key, value } = req.body;
      let ok: boolean;
      try {
        ok = db.set(key, value);
      } catch (err) {
        return reply.status(400).send({ detail: err instanceof Error ? err.message : String(err) });
      }

      if (!ok) {
        return reply.status(507).send({ detail: 'Database full (256-bucket limit reached)' });
      }

      return { status: 'ok', key, value };
    },
  );

  app.get(
    '/db',
    {
      schema: {
        summary: 'List all entries',
      },
    },
    async () => {
      const items = db.items();
      return {
        count: items.length,
        entries: items.map(([key, value]) => ({ key, value })),
      };
    },
  );

  app.get<{ Params: { '*': string } }>(
    '/db/*',
    {
      schema: {
        summary: 'Retrieve single key',
      },
    },
    async (req, reply) => {
      const key = req.params['*'];
      const value = db.get(key);
      if (value === null) {
        return reply.status(404).send({ detail: `Key '${key}' not found` });
      }
      return { key, value };
    },
  );

  app.delete<{ Params: { '*': string } }>(
    '/db/*',
    {
      schema: {
        summary: 'Delete key',
      },
    },
    async (req, reply) => {
      guard();
      const key = req.params['*'];
      if (!db.delete(key)) {
        return reply.status(404).send({ detail: `Key '${key}' not found` });
      }
      return { status: 'deleted', key };
    },
  );

  app.post(
    '/clear',
    {
      schema: {
        summary: 'Clear all database entries',
      },
    },
    async () => {
      guard();
      db.clear();
      return { status: 'cleared' };
    },
  );

  app.get(
    '/stats',
    {
      schema: {
        summary: 'Get database statistics',
      },
    },
    async () => db.stats(),
  );

  app.get<{ Querystring: { start?: number; length?: number } }>(
    '/tape',
    {
      schema: {
        summary: 'Debug: view raw tape cells',
      },
    },
    async (req) => {
      const start = req.query.start ? Number(req.query.start) : 0;
      const length = Math.min(req.query.length ? Number(req.query.length) : 512, 1000);
      const cells = db.dumpTape(start, length);
      return { start, length: cells.length, cells };
    },
  );

  return app;
}
