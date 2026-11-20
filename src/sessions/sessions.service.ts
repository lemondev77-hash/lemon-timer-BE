import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

export interface TimerSessionRow {
  id: string;
  user_id: string;
  session_id: string;
  name: string;
  event: string;
  created_at: string;
}

@Injectable()
export class SessionsService implements OnModuleInit {
  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
  });

  async onModuleInit() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS timer_sessions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        name VARCHAR(100) NOT NULL DEFAULT 'Session 1',
        event VARCHAR(20) NOT NULL DEFAULT '333',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, session_id)
      );
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_timer_sessions_user_id ON timer_sessions(user_id);
    `);
  }

  private mapRow(row: any) {
    return {
      id: row.session_id,
      name: row.name,
      event: row.event || '333',
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /** Lấy tất cả sessions của user */
  async findAll(userId: string) {
    const res = await this.pool.query(
      'SELECT * FROM timer_sessions WHERE user_id = $1 ORDER BY created_at ASC',
      [userId],
    );
    if (res.rows.length === 0) {
      await this.pool.query(
        `INSERT INTO timer_sessions (user_id, session_id, name, event, created_at)
         VALUES ($1, 'session_1', 'Session 1', '333', CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, session_id) DO NOTHING`,
        [userId],
      );
      const res2 = await this.pool.query(
        'SELECT * FROM timer_sessions WHERE user_id = $1 ORDER BY created_at ASC',
        [userId],
      );
      return res2.rows.map((r) => this.mapRow(r));
    }
    return res.rows.map((r) => this.mapRow(r));
  }

  /** Đồng bộ toàn bộ sessions (thay thế hoàn toàn) */
  async syncAll(
    userId: string,
    sessions: { id: string; name: string; event?: string; createdAt?: string }[],
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Xóa sessions cũ của user
      await client.query('DELETE FROM timer_sessions WHERE user_id = $1', [userId]);

      // Thêm sessions mới
      for (const s of sessions) {
        await client.query(
          `INSERT INTO timer_sessions (user_id, session_id, name, event, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, session_id) DO UPDATE SET name = $3, event = $4`,
          [
            userId,
            s.id,
            s.name || 'Session',
            s.event || '333',
            s.createdAt ? new Date(s.createdAt) : new Date(),
          ],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.findAll(userId);
  }

  /** Thêm 1 session mới */
  async create(
    userId: string,
    sessionId: string,
    name: string,
    event: string = '333',
    createdAt?: string,
  ) {
    await this.pool.query(
      `INSERT INTO timer_sessions (user_id, session_id, name, event, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, session_id) DO UPDATE SET name = $3, event = $4`,
      [userId, sessionId, name, event, createdAt ? new Date(createdAt) : new Date()],
    );
    return this.findAll(userId);
  }

  /** Đổi tên session */
  async rename(userId: string, sessionId: string, newName: string) {
    await this.pool.query(
      'UPDATE timer_sessions SET name = $1 WHERE user_id = $2 AND session_id = $3',
      [newName, userId, sessionId],
    );
    return this.findAll(userId);
  }

  /** Xóa session */
  async remove(userId: string, sessionId: string) {
    await this.pool.query(
      'DELETE FROM timer_sessions WHERE user_id = $1 AND session_id = $2',
      [userId, sessionId],
    );
    return this.findAll(userId);
  }
}
