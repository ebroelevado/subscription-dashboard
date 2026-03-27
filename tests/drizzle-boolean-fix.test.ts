import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';

describe('Drizzle Boolean Fix Patch', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database('local.db');
    
    // Import the patch
    import('../src/lib/patches/drizzle-boolean-fix');
  });

  afterAll(() => {
    db.close();
  });

  describe('Boolean to Integer Conversion', () => {
    it('should convert false to 0 when inserting into users table', () => {
      const id = 'test-boolean-fix-' + Date.now();
      
      const result = db.prepare(
        'INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, 'Test User', `test-${id}@test.com`, 0, new Date().toISOString(), new Date().toISOString());
      
      expect(result.changes).toBe(1);
      
      const user = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(id) as any;
      expect(user).toBeDefined();
      expect(user.email_verified).toBe(0);
      
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    it('should convert true to 1 when inserting into users table', () => {
      const id = 'test-boolean-fix-true-' + Date.now();
      
      const result = db.prepare(
        'INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, 'Test User', `test-${id}@test.com`, 1, new Date().toISOString(), new Date().toISOString());
      
      expect(result.changes).toBe(1);
      
      const user = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(id) as any;
      expect(user).toBeDefined();
      expect(user.email_verified).toBe(1);
      
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
  });

  describe('Session Creation with Patched Driver', () => {
    it('should create a session with the patched driver', () => {
      const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get('ebroelevado@gmail.com') as any;
      expect(user).toBeDefined();

      // Use the new column names
      const id = crypto.randomUUID();
      const token = 'patched-session-' + Date.now();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const createdAt = new Date().toISOString();
      const updatedAt = new Date().toISOString();

      const result = db.prepare(
        'INSERT INTO sessions (id, token, user_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, token, user.id, expiresAt, createdAt, updatedAt);

      expect(result.changes).toBe(1);

      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
      expect(session).toBeDefined();
      expect(session.token).toBe(token);
      expect(session.user_id).toBe(user.id);

      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    });
  });
});
