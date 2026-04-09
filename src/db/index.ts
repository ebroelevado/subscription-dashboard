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

function resolveLocalDbPath(pathModule: any): string {
  const explicitPath = process.env.LOCAL_SQLITE_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  // In containerized production environments, /tmp is typically writable.
  if (process.env.NODE_ENV === "production") {
    return "/tmp/local.db";
  }

  return pathModule.join(process.cwd(), "local.db");
}

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
  const fs = require("fs");
  const { drizzle: drizzleSQLite } = require("drizzle-orm/better-sqlite3");
  const path = require("path");

  const dbPath = resolveLocalDbPath(path);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

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

// Build a wrapped Remote D1 database that talks to our Worker Proxy
function createRemoteD1Db(): SchemaDatabase {
  const remoteUrl = process.env.AGENT_SESSION_URL;
  const secret = process.env.DB_PROXY_SECRET;

  if (!remoteUrl || !secret) {
    throw new Error("Remote DB requested but AGENT_SESSION_URL or DB_PROXY_SECRET is missing.");
  }

  const d1Proxy: D1Database = {
    prepare(sqlStr: string) {
      return {
        bind(...values: unknown[]) {
          return {
            _sql: sqlStr,
            _params: values,
            async run() {
              const res = await fetch(`${remoteUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sql: sqlStr, params: values, secret, method: "run" }),
              });
              if (!res.ok) throw new Error(`Remote D1 Error: ${await res.text()}`);
              return res.json();
            },
            async all() {
              const res = await fetch(`${remoteUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sql: sqlStr, params: values, secret, method: "all" }),
              });
              if (!res.ok) throw new Error(`Remote D1 Error: ${await res.text()}`);
              return res.json();
            },
            async first(colName?: string) {
              const res = await fetch(`${remoteUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sql: sqlStr, params: values, secret, method: "all" }),
              });
              if (!res.ok) throw new Error(`Remote D1 Error: ${await res.text()}`);
              const result = await res.json() as any;
              const first = result?.results?.[0];
              if (!first) return null;
              return colName ? first[colName] : first;
            },
            async raw(options?: { columnNames: boolean }) {
              const res = await fetch(`${remoteUrl}/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sql: sqlStr, params: values, secret, method: "all" }),
              });
              if (!res.ok) throw new Error(`Remote D1 Error: ${await res.text()}`);
              const result = await res.json() as any;
              const rows = Array.isArray(result?.results) ? result.results : [];

              if (rows.length === 0) {
                return [];
              }

              if (Array.isArray(rows[0])) {
                return rows;
              }

              const columns = Object.keys(rows[0]);
              const matrix = rows.map((row: Record<string, unknown>) =>
                columns.map((col) => row[col])
              );

              return options?.columnNames ? [columns, ...matrix] : matrix;
            }
          } as any;
        },
        _sql: sqlStr,
        _params: [] as unknown[],
        async run() { return this.bind().run(); },
        async all() { return this.bind().all(); },
        async first(colName?: string) { return this.bind().first(colName); },
        async raw(options?: { columnNames: boolean }) { return this.bind().raw(options); }
      } as any;
    },
    async dump() { throw new Error("Dump not supported on remote D1 proxy"); },
    async batch(statements: any[]) {
      const queries = statements.map(s => ({
        sql: s._sql,
        params: s._params
      }));
      
      const res = await fetch(`${remoteUrl}/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries, secret }),
      });
      if (!res.ok) throw new Error(`Remote D1 Batch Error: ${await res.text()}`);
      return res.json();
    },
    async exec(sql: string) {
      const res = await fetch(`${remoteUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, secret }),
      });
      if (!res.ok) throw new Error(`Remote D1 Error: ${await res.text()}`);
      const result = await res.json() as any;
      return { count: result.meta?.changes || 0, duration: 0 };
    }
  };

  return createWrappedD1Db(d1Proxy);
}

// Get database instance - automatically detects context
export function getDb(): SchemaDatabase {
  if (_cachedDb) {
    return _cachedDb;
  }

  // Support for Remote D1 Sync (Real DB) in local development
  if (process.env.USE_REMOTE_DB === "true") {
    const hasRemoteUrl = Boolean(process.env.AGENT_SESSION_URL);
    const hasRemoteSecret = Boolean(process.env.DB_PROXY_SECRET);

    if (hasRemoteUrl && hasRemoteSecret) {
      console.log("🌐 Connecting to REMOTE Cloudflare D1 database via Worker Proxy");
      _cachedDb = createRemoteD1Db();
      _cachedDirectDb = _cachedDb;
      return _cachedDb;
    }

    console.warn(
      "[db] USE_REMOTE_DB=true but AGENT_SESSION_URL/DB_PROXY_SECRET are missing. Falling back to local SQLite.",
    );
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
