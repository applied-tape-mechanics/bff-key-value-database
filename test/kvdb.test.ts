import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { BrainfuckKVDB } from '../src/engine.ts';

describe('Brainfuck Hash Program', () => {
  it('hash deterministic', () => {
    const db = new BrainfuckKVDB();
    assert.equal(db.hashKey('hello'), db.hashKey('hello'));
  });

  it('hash abc (97+98+99 = 294 mod 256 = 38)', () => {
    const db = new BrainfuckKVDB();
    assert.equal(db.hashKey('abc'), 38);
  });

  it('hash single char (A = 65)', () => {
    const db = new BrainfuckKVDB();
    assert.equal(db.hashKey('A'), 65);
  });

  it('hash different keys', () => {
    const db = new BrainfuckKVDB();
    const h1 = db.hashKey('foo');
    const h2 = db.hashKey('bar');
    assert.ok(h1 >= 0 && h1 <= 255);
    assert.ok(h2 >= 0 && h2 <= 255);
  });
});

describe('KVDB Engine CRUD', () => {
  let db: BrainfuckKVDB;
  beforeEach(() => {
    db = new BrainfuckKVDB();
  });

  it('set and get', () => {
    db.set('greeting', 'hello world');
    assert.equal(db.get('greeting'), 'hello world');
  });

  it('get missing key', () => {
    assert.equal(db.get('does-not-exist'), null);
  });

  it('update value', () => {
    db.set('key', 'v1');
    db.set('key', 'v2');
    assert.equal(db.get('key'), 'v2');
    assert.equal(db.size(), 1);
  });

  it('delete', () => {
    db.set('temp', 'data');
    assert.equal(db.delete('temp'), true);
    assert.equal(db.get('temp'), null);
  });

  it('delete missing', () => {
    assert.equal(db.delete('ghost'), false);
  });

  it('delete then reinsert', () => {
    db.set('reuse', 'first');
    db.delete('reuse');
    db.set('reuse', 'second');
    assert.equal(db.get('reuse'), 'second');
  });

  it('exists', () => {
    db.set('present', 'yes');
    assert.equal(db.exists('present'), true);
    assert.equal(db.exists('absent'), false);
  });

  it('keys', () => {
    db.set('x', '1');
    db.set('y', '2');
    db.set('z', '3');
    assert.deepEqual(db.keys().sort(), ['x', 'y', 'z']);
  });

  it('items', () => {
    db.set('a', '10');
    db.set('b', '20');
    assert.deepEqual(Object.fromEntries(db.items()), { a: '10', b: '20' });
  });

  it('size', () => {
    assert.equal(db.size(), 0);
    db.set('a', '1');
    assert.equal(db.size(), 1);
    db.set('b', '2');
    assert.equal(db.size(), 2);
    db.delete('a');
    assert.equal(db.size(), 1);
  });

  it('clear', () => {
    for (let i = 0; i < 10; i++) db.set(`k${i}`, `v${i}`);
    db.clear();
    assert.equal(db.size(), 0);
    assert.equal(db.get('k0'), null);
  });

  it('stats', () => {
    db.set('s', '1');
    db.get('s');
    db.delete('s');
    const stats = db.stats();
    assert.ok(stats.sets >= 1);
    assert.ok(stats.gets >= 1);
    assert.ok(stats.deletes >= 1);
    assert.equal(stats.capacity, 256);
    assert.equal(stats.tape_size, 65536);
  });
});

describe('Edge cases & limits', () => {
  let db: BrainfuckKVDB;
  beforeEach(() => {
    db = new BrainfuckKVDB();
  });

  it('max key length (63)', () => {
    const k = 'a'.repeat(63);
    db.set(k, 'value');
    assert.equal(db.get(k), 'value');
  });

  it('key too long (64) throws', () => {
    assert.throws(() => db.set('a'.repeat(64), 'value'), /Key must be/);
  });

  it('max value length (189)', () => {
    const v = 'b'.repeat(189);
    db.set('key', v);
    assert.equal(db.get('key'), v);
  });

  it('value too long (190) throws', () => {
    assert.throws(() => db.set('key', 'b'.repeat(190)), /Value must be/);
  });

  it('empty key rejected', () => {
    assert.throws(() => db.set('', 'value'), /Key must be/);
  });

  it('empty value allowed', () => {
    db.set('k', '');
    assert.equal(db.get('k'), '');
  });

  it('collision handling (80 keys survive)', () => {
    const count = 80;
    for (let i = 0; i < count; i++) {
      db.set(`key-${String(i).padStart(4, '0')}`, `val-${i}`);
    }
    for (let i = 0; i < count; i++) {
      assert.equal(db.get(`key-${String(i).padStart(4, '0')}`), `val-${i}`);
    }
    assert.equal(db.size(), count);
  });

  it('delete does not break probe chain', () => {
    const keys = ['aa', 'bb', 'cc', 'dd', 'ee'];
    for (const k of keys) db.set(k, k.toUpperCase());
    db.delete('cc');
    for (const k of keys) {
      if (k === 'cc') assert.equal(db.get(k), null);
      else assert.equal(db.get(k), k.toUpperCase());
    }
  });

  it('dump tape', () => {
    db.set('t', '1');
    const cells = db.dumpTape(0, 32);
    assert.equal(cells.length, 32);
  });
});

describe('HTTP API', () => {
  let app: FastifyInstance;
  let db: BrainfuckKVDB;

  beforeEach(async () => {
    db = new BrainfuckKVDB();
    app = await buildApp({ db });
  });

  it('GET /', async () => {
    const res = await app.inject('/');
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().service.includes('Brainfuck'));
  });

  it('GET /health', async () => {
    const res = await app.inject('/health');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'UP');
  });

  it('PUT /db and GET /db/{key}', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: '/db',
      payload: { key: 'lang', value: 'brainfuck' },
    });
    assert.equal(putRes.statusCode, 200);

    const getRes = await app.inject('/db/lang');
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.json().value, 'brainfuck');
  });

  it('GET /db/{key} missing -> 404', async () => {
    const res = await app.inject('/db/nope');
    assert.equal(res.statusCode, 404);
  });

  it('DELETE /db/{key}', async () => {
    await app.inject({ method: 'PUT', url: '/db', payload: { key: 'del', value: 'me' } });
    const delRes = await app.inject({ method: 'DELETE', url: '/db/del' });
    assert.equal(delRes.statusCode, 200);
    const getRes = await app.inject('/db/del');
    assert.equal(getRes.statusCode, 404);
  });

  it('GET /db list entries', async () => {
    await app.inject({ method: 'PUT', url: '/db', payload: { key: 'a', value: '1' } });
    await app.inject({ method: 'PUT', url: '/db', payload: { key: 'b', value: '2' } });
    const res = await app.inject('/db');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().count, 2);
  });

  it('POST /clear', async () => {
    await app.inject({ method: 'PUT', url: '/db', payload: { key: 'x', value: 'y' } });
    const clr = await app.inject({ method: 'POST', url: '/clear' });
    assert.equal(clr.statusCode, 200);
    const res = await app.inject('/db');
    assert.equal(res.json().count, 0);
  });

  it('GET /stats', async () => {
    const res = await app.inject('/stats');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().capacity, 256);
  });

  it('GET /tape', async () => {
    const res = await app.inject('/tape?start=0&length=64');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().cells.length, 64);
  });
});
