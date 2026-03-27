import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

describe('Authentication', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database('local.db');
  });

  afterAll(() => {
    db.close();
  });

  describe('Password Verification', () => {
    it('should verify password correctly', async () => {
      const user = db.prepare('SELECT id, email, password FROM users WHERE email = ?').get('ebroelevado@gmail.com') as any;
      expect(user).toBeDefined();
      
      const password = 'Noviembre29@#';
      const match = await bcrypt.compare(password, user.password);
      expect(match).toBe(true);
    });

    it('should have credential account', async () => {
      const user = db.prepare('SELECT id, email, password FROM users WHERE email = ?').get('ebroelevado@gmail.com') as any;
      expect(user).toBeDefined();

      const account = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND provider_id = ?').get(user.id, 'credential') as any;
      expect(account).toBeDefined();
      expect(account.password).toBeDefined();
      expect(account.password).toBe(user.password);
    });
  });

  describe('Database Schema', () => {
    it('should have correct sessions table schema', () => {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get() as any;
      expect(schema).toBeDefined();
      // The new schema uses token, not session_token
      expect(schema.sql).toContain('token');
      expect(schema.sql).toContain('expires_at');
      expect(schema.sql).toContain('created_at');
      expect(schema.sql).toContain('updated_at');
    });

    it('should have correct accounts table schema', () => {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'").get() as any;
      expect(schema).toBeDefined();
      // The new schema uses account_id and provider_id
      expect(schema.sql).toContain('account_id');
      expect(schema.sql).toContain('provider_id');
      expect(schema.sql).toContain('password');
      expect(schema.sql).toContain('created_at');
      expect(schema.sql).toContain('updated_at');
    });
  });

  describe('Session Creation', () => {
    it('should create a session with new schema', () => {
      const user = db.prepare('SELECT id, email, password FROM users WHERE email = ?').get('ebroelevado@gmail.com') as any;
      expect(user).toBeDefined();

      // Use the new column names
      const id = crypto.randomUUID();
      const token = 'test-token-' + Date.now();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const createdAt = new Date().toISOString();
      const updatedAt = new Date().toISOString();

      const result = db.prepare(
        'INSERT INTO sessions (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, token, user.id, expiresAt, createdAt, updatedAt);

      expect(result.changes).toBe(1);

      // Verify the session was created
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
      expect(session).toBeDefined();
      expect(session.token).toBe(token);
      expect(session.user_id).toBe(user.id);

      // Clean up
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    });
  });

  describe('Sign In Flow', () => {
    it('should verify sign-in flow', async () => {
      const user = db.prepare('SELECT id, email, password FROM users WHERE email = ?').get('ebroelevado@gmail.com') as any;
      expect(user).toBeDefined();

      // Verify password
      const password = 'Noviembre29@#';
      const match = await bcrypt.compare(password, user.password);
      expect(match).toBe(true);

      // Check credential account
      const account = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND provider_id = ?').get(user.id, 'credential') as any;
      expect(account).toBeDefined();
      expect(account.password).toBeDefined();

      // Verify account password matches user password
      const accountMatch = await bcrypt.compare(password, account.password);
      expect(accountMatch).toBe(true);

      // Create a session
      const id = crypto.randomUUID();
      const token = 'sign-in-test-' + Date.now();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const createdAt = new Date().toISOString();
      const updatedAt = new Date().toISOString();

      const result = db.prepare(
        'INSERT INTO sessions (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, token, user.id, expiresAt, createdAt, updatedAt);

      expect(result.changes).toBe(1);

      // Clean up
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    });
  });
});
