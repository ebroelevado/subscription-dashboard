import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

// NOTE: better-sqlite3 is used for local development with Vinext/Vite SSR.
// Vinext runs SSR with Node.js (not Bun), so bun:sqlite doesn't work.
// better-sqlite3 is marked as external in vite.config.ts so Vite doesn't try to bundle the native bindings.

export type D1Database = {
  prepare(sql: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<D1ExecResult>;
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T[]>>;
  raw<T = unknown>(options?: { columnNames: boolean }): Promise<T[]>;
};

export type D1Result<T = unknown> = {
  results?: T;
  success: boolean;
  error?: string;
  meta: {
    changed_db: boolean;
    changes: number;
    duration: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
    size_after: number;
  };
};

export type D1ExecResult = {
  count: number;
  duration: number;
};

export type SchemaDatabase = ReturnType<typeof drizzleD1<typeof schema>> & {
  execute: <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => Promise<{
    results: T[];
    rows: T[];
    meta: {
      changed_db: boolean;
      changes: number;
      duration: number;
      last_row_id: number;
      rows_read: number;
      rows_written: number;
      size_after: number;
    };
  }>;
};

// Build a wrapped D1 database with execute method
function createWrappedD1Db(d1Binding: D1Database): SchemaDatabase {
  const baseDb = drizzleD1(d1Binding, { schema, logger: true });

  const wrappedDb = new Proxy(baseDb, {
    get(target, prop) {
      if (prop === "execute") {
        return async (query: ReturnType<typeof sql>) => {
          const queryObj = query as any;
          let sqlStr: string;
          let params: unknown[] = [];

          if (queryObj.queryChunks) {
            sqlStr = "";
            for (const chunk of queryObj.queryChunks) {
              if (typeof chunk === "string") {
                sqlStr += chunk;
              } else if (chunk && typeof chunk === "object" && "value" in chunk) {
                sqlStr += "?";
                params.push((chunk as any).value);
              } else {
                sqlStr += String(chunk);
              }
            }
          } else {
            sqlStr = String(query);
          }

          const prepared = d1Binding.prepare(sqlStr);
          const bound = params.length
            ? prepared.bind(...params)
            : prepared;
          const result = await bound.run();
          return {
            results: (result.results as any[]) ?? [],
            rows: (result.results as any[]) ?? [],
            meta: result.meta,
          };
        };
      }
      return (target as any)[prop];
    },
  }) as unknown as SchemaDatabase;

  return wrappedDb;
}

// Module-level cache for the database instance
let _cachedDb: SchemaDatabase | null = null;
let _cachedDirectDb: SchemaDatabase | null = null;
let _usingLocalSQLite = false;
let _sqlite: any = null;

// Build a wrapped SQLite database with execute method (for local dev with Vinext)
// Uses better-sqlite3 which works with Node.js (Vinext's SSR runtime)
function createWrappedSQLiteDb(): SchemaDatabase {
  const Database = require("better-sqlite3");
  const { drizzle: drizzleSQLite } = require("drizzle-orm/better-sqlite3");
  const path = require("path");

  const dbPath = path.join(process.cwd(), "local.db");

  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");

  const baseDb = drizzleSQLite(_sqlite, { schema, logger: true });

  const wrappedDb = new Proxy(baseDb, {
    get(target, prop) {
      if (prop === "execute") {
        return async (query: ReturnType<typeof sql>) => {
          const queryObj = query as any;
          let sqlStr: string;
          let params: unknown[] = [];

          if (queryObj.queryChunks) {
            sqlStr = "";
            for (const chunk of queryObj.queryChunks) {
              if (typeof chunk === "string") {
                sqlStr += chunk;
              } else if (chunk && typeof chunk === "object" && "value" in chunk) {
                sqlStr += "?";
                params.push((chunk as any).value);
              } else {
                sqlStr += String(chunk);
              }
            }
          } else {
            sqlStr = String(query);
          }

          const stmt = _sqlite.prepare(sqlStr);
          let results: any[];

          if (sqlStr.trim().toUpperCase().startsWith("SELECT") || sqlStr.trim().toUpperCase().startsWith("WITH")) {
            results = params.length ? stmt.all(...params) : stmt.all();
          } else {
            const info = params.length ? stmt.run(...params) : stmt.run();
            results = [];
            return {
              results,
              rows: results,
              meta: {
                changed_db: true,
                changes: info.changes,
                duration: 0,
                last_row_id: Number(info.lastInsertRowid),
                rows_read: 0,
                rows_written: info.changes,
                size_after: 0,
              },
            };
          }

          return {
            results,
            rows: results,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 0,
              last_row_id: 0,
              rows_read: results.length,
              rows_written: 0,
              size_after: 0,
            },
          };
        };
      }
      if (prop === "transaction") {
        return async <T>(cb: (tx: any) => Promise<T>): Promise<T> => {
           const dbInstance = _sqlite;
           dbInstance.exec("BEGIN");
           try {
             // Pass the baseDb (which has the execute proxy applied through target)
             // Wait, target is baseDb (unwrapped). But cb expects wrappedDb.
             // It's safe enough to pass wrappedDb (or target) since this is a proxy.
             const result = await cb(wrappedDb);
             dbInstance.exec("COMMIT");
             return result as T;
           } catch (err) {
             dbInstance.exec("ROLLBACK");
             throw err;
           }
        };
      }
      return (target as any)[prop];
    },
  }) as unknown as SchemaDatabase;

  return wrappedDb;
}

// Get database instance - automatically detects context
export function getDb(): SchemaDatabase {
  if (_cachedDb) {
    return _cachedDb;
  }

  // For local development, use better-sqlite3 with Node.js (Vinext SSR)
  // In production (Cloudflare Workers), use D1 binding via vinext/cloudflare
  console.log("📦 Using local SQLite database for development (local.db)");
  _cachedDb = createWrappedSQLiteDb();
  _cachedDirectDb = _cachedDb;
  _usingLocalSQLite = true;
  return _cachedDb;
}

// Get the direct database instance (without Proxy) for use with DrizzleAdapter
export function getDirectDb(): SchemaDatabase {
  if (_cachedDirectDb) {
    return _cachedDirectDb;
  }

  getDb();
  return _cachedDirectDb!;
}

// Export db for backward compatibility
export const db: SchemaDatabase = new Proxy({} as SchemaDatabase, {
  get(_target, prop) {
    const database = getDb();
    return (database as any)[prop];
  },
});

// Manual initialization for explicit D1 binding (Cloudflare Workers production)
export function initDb(d1Binding: D1Database): SchemaDatabase {
  _cachedDb = createWrappedD1Db(d1Binding);
  _usingLocalSQLite = false;
  return _cachedDb;
}

// Check if using local SQLite
export function isUsingLocalSQLite(): boolean {
  return _usingLocalSQLite;
}

export type Database = SchemaDatabase;
