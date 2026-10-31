/**
 * Brainfuck Key-Value Database Engine.
 *
 * Architecture:
 * - The Brainfuck interpreter's 65,536-cell (64k) tape IS the database storage medium.
 * - A pure-BF program (`bf/hash.bf`) computes bucket indices by summing key bytes (mod 256).
 * - TypeScript handles HTTP networking, tape addressing, open-address probing,
 *   and tombstone-based deletion.
 *
 * Tape Memory Layout:
 * - Cells 0-255: Working area (scratch space used during BF execution)
 * - Cells 256-65535: Storage — 256 buckets x 255 cells each (65,280 cells)
 *
 * Bucket structure (255 cells):
 *   [0]       flag  0=empty, 1=occupied, 2=tombstone
 *   [1-64]    key   null-terminated, <=63 UTF-8 bytes
 *   [65-254]  value null-terminated, <=189 UTF-8 bytes
 */

import { readFileSync } from 'node:fs';
import { BrainfuckVM, cleanCode, compile, type Program } from 'bff-interpreter';

export const TAPE_SIZE = 65_536;
export const WORK_AREA_START = 0;
export const WORK_AREA_SIZE = 256;

export const STORAGE_START = 256;
export const BUCKET_SIZE = 255;
export const BUCKET_COUNT = 256;
export const KEY_MAX_LEN = 63;
export const VALUE_MAX_LEN = 189;

export const FLAG_OFFSET = 0;
export const KEY_OFFSET = 1;
export const VAL_OFFSET = 65;

export const EMPTY = 0;
export const OCCUPIED = 1;
export const TOMBSTONE = 2;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function loadBf(dir: URL, name: string): string {
  return cleanCode(readFileSync(new URL(name, dir), 'utf-8'));
}

export interface KVStats {
  sets: number;
  gets: number;
  deletes: number;
  collisions: number;
  size: number;
  capacity: number;
  tape_size: number;
}

export class BrainfuckKVDB {
  readonly vm: BrainfuckVM;
  readonly bfHashSource: string;
  private readonly hashProgram: Program;
  private _stats = {
    sets: 0,
    gets: 0,
    deletes: 0,
    collisions: 0,
  };

  constructor(bfDir: URL = new URL('../bf/', import.meta.url)) {
    this.vm = new BrainfuckVM({ tapeSize: TAPE_SIZE });
    this.bfHashSource = loadBf(bfDir, 'hash.bf');
    this.hashProgram = compile(this.bfHashSource);
  }

  /**
   * Hashes key to bucket index 0-255 using the pure Brainfuck hash program.
   */
  hashKey(key: string): number {
    const keyBytes = new Uint8Array(encoder.encode(key).length + 1);
    keyBytes.set(encoder.encode(key));
    keyBytes[keyBytes.length - 1] = 0; // null-terminated

    // Snapshot working area
    const saved = this.vm.readTape(WORK_AREA_START, WORK_AREA_SIZE);
    const savedPtr = this.vm.pointer;

    this.vm.writeTape(WORK_AREA_START, new Uint8Array(WORK_AREA_SIZE));
    this.vm.pointer = 0;

    const result = this.vm.run(this.hashProgram, keyBytes);

    // Restore working area
    this.vm.writeTape(WORK_AREA_START, saved);
    this.vm.pointer = savedPtr;

    return result.length > 0 ? result[0] : 0;
  }

  private bucketAddr(index: number): number {
    return STORAGE_START + (((index % BUCKET_COUNT) + BUCKET_COUNT) % BUCKET_COUNT) * BUCKET_SIZE;
  }

  private flag(addr: number): number {
    return this.vm.readCell(addr + FLAG_OFFSET);
  }

  private readKey(addr: number): string {
    const raw = this.vm.readTape(addr + KEY_OFFSET, KEY_MAX_LEN + 1);
    const end = raw.indexOf(0);
    return decoder.decode(raw.slice(0, end >= 0 ? end : raw.length));
  }

  private readValue(addr: number): string {
    const raw = this.vm.readTape(addr + VAL_OFFSET, VALUE_MAX_LEN + 1);
    const end = raw.indexOf(0);
    return decoder.decode(raw.slice(0, end >= 0 ? end : raw.length));
  }

  private writeBucket(addr: number, key: string, value: string): void {
    this.vm.writeCell(addr + FLAG_OFFSET, OCCUPIED);

    const kBytes = encoder.encode(key).slice(0, KEY_MAX_LEN);
    const kSlot = new Uint8Array(KEY_MAX_LEN + 1);
    kSlot.set(kBytes);
    this.vm.writeTape(addr + KEY_OFFSET, kSlot);

    const vBytes = encoder.encode(value).slice(0, VALUE_MAX_LEN);
    const vSlot = new Uint8Array(VALUE_MAX_LEN + 1);
    vSlot.set(vBytes);
    this.vm.writeTape(addr + VAL_OFFSET, vSlot);
  }

  /**
   * Inserts or updates key-value pair.
   * Returns true on success, false if table is full.
   */
  set(key: string, value: string): boolean {
    const keyBytes = encoder.encode(key);
    if (!key || keyBytes.length > KEY_MAX_LEN) {
      throw new Error(`Key must be 1–${KEY_MAX_LEN} UTF-8 bytes`);
    }
    if (encoder.encode(value).length > VALUE_MAX_LEN) {
      throw new Error(`Value must be <= ${VALUE_MAX_LEN} UTF-8 bytes`);
    }

    const start = this.hashKey(key);
    let firstTombstone: number | null = null;

    for (let probe = 0; probe < BUCKET_COUNT; probe++) {
      const idx = (start + probe) % BUCKET_COUNT;
      const addr = this.bucketAddr(idx);
      const fl = this.flag(addr);

      if (fl === EMPTY) {
        const target = firstTombstone !== null ? this.bucketAddr(firstTombstone) : addr;
        this.writeBucket(target, key, value);
        this._stats.sets++;
        if (probe > 0) this._stats.collisions++;
        return true;
      }

      if (fl === TOMBSTONE) {
        if (firstTombstone === null) {
          firstTombstone = idx;
        }
      } else if (fl === OCCUPIED) {
        if (this.readKey(addr) === key) {
          this.writeBucket(addr, key, value);
          this._stats.sets++;
          return true;
        }
      }
    }

    if (firstTombstone !== null) {
      this.writeBucket(this.bucketAddr(firstTombstone), key, value);
      this._stats.sets++;
      return true;
    }

    return false;
  }

  get(key: string): string | null {
    const start = this.hashKey(key);

    for (let probe = 0; probe < BUCKET_COUNT; probe++) {
      const idx = (start + probe) % BUCKET_COUNT;
      const addr = this.bucketAddr(idx);
      const fl = this.flag(addr);

      if (fl === EMPTY) {
        this._stats.gets++;
        return null;
      }
      if (fl === TOMBSTONE) continue;
      if (fl === OCCUPIED && this.readKey(addr) === key) {
        this._stats.gets++;
        return this.readValue(addr);
      }
    }

    this._stats.gets++;
    return null;
  }

  delete(key: string): boolean {
    const start = this.hashKey(key);

    for (let probe = 0; probe < BUCKET_COUNT; probe++) {
      const idx = (start + probe) % BUCKET_COUNT;
      const addr = this.bucketAddr(idx);
      const fl = this.flag(addr);

      if (fl === EMPTY) return false;
      if (fl === TOMBSTONE) continue;
      if (fl === OCCUPIED && this.readKey(addr) === key) {
        this.vm.writeCell(addr + FLAG_OFFSET, TOMBSTONE);
        this._stats.deletes++;
        return true;
      }
    }

    return false;
  }

  exists(key: string): boolean {
    return this.get(key) !== null;
  }

  keys(): string[] {
    const out: string[] = [];
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const addr = this.bucketAddr(i);
      if (this.flag(addr) === OCCUPIED) {
        out.push(this.readKey(addr));
      }
    }
    return out;
  }

  items(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const addr = this.bucketAddr(i);
      if (this.flag(addr) === OCCUPIED) {
        out.push([this.readKey(addr), this.readValue(addr)]);
      }
    }
    return out;
  }

  size(): number {
    let n = 0;
    for (let i = 0; i < BUCKET_COUNT; i++) {
      if (this.flag(this.bucketAddr(i)) === OCCUPIED) n++;
    }
    return n;
  }

  clear(): void {
    this.vm.reset();
    this._stats = {
      sets: 0,
      gets: 0,
      deletes: 0,
      collisions: 0,
    };
  }

  stats(): KVStats {
    return {
      ...this._stats,
      size: this.size(),
      capacity: BUCKET_COUNT,
      tape_size: this.vm.tapeSize,
    };
  }

  dumpTape(start = 0, length = 512): number[] {
    return Array.from(this.vm.readTape(start, length));
  }
}
