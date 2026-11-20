import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class SolvesService implements OnModuleInit {
  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  });

  async onModuleInit() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS practice_solves (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        time_ms INTEGER NOT NULL,
        scramble TEXT NOT NULL,
        penalty VARCHAR(20) NOT NULL DEFAULT 'NONE',
        event VARCHAR(20) NOT NULL DEFAULT '333',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      ALTER TABLE practice_solves
      ADD COLUMN IF NOT EXISTS user_id TEXT;
    `);

    await this.pool.query(`
      ALTER TABLE practice_solves
      ADD COLUMN IF NOT EXISTS event VARCHAR(20) NOT NULL DEFAULT '333';
    `);

    await this.pool.query(`
      ALTER TABLE practice_solves
      ADD COLUMN IF NOT EXISTS session_id VARCHAR(50) DEFAULT 'session_1';
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_practice_solves_user_id ON practice_solves(user_id);
    `);
  }

  private mapRow(row: any) {
    return {
      id: String(row.id),
      userId: row.user_id ?? null,
      timeMs: row.time_ms,
      scramble: row.scramble,
      event: row.event || '333',
      penalty: row.penalty,
      sessionId: row.session_id || 'session_1',
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async findAll(userId?: string | null) {
    if (userId) {
      const res = await this.pool.query(
        'SELECT * FROM practice_solves WHERE user_id = $1 ORDER BY created_at DESC',
        [userId],
      );
      return res.rows.map((r) => this.mapRow(r));
    }

    const res = await this.pool.query(
      'SELECT * FROM practice_solves WHERE user_id IS NULL ORDER BY created_at DESC',
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async create(
    timeMs: number,
    scramble: string,
    penalty: 'NONE' | '+2' | 'DNF' = 'NONE',
    userId: string | null = null,
    event: string = '333',
    sessionId: string = 'session_1',
  ) {
    const res = await this.pool.query(
      `INSERT INTO practice_solves (time_ms, scramble, penalty, user_id, event, session_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [timeMs, scramble, penalty, userId, event || '333', sessionId || 'session_1'],
    );
    return this.mapRow(res.rows[0]);
  }

  async updatePenalty(id: string, penalty: 'NONE' | '+2' | 'DNF') {
    const res = await this.pool.query(
      `UPDATE practice_solves SET penalty = $1 WHERE id = $2 RETURNING *`,
      [penalty, Number(id)],
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async remove(id: string) {
    await this.pool.query('DELETE FROM practice_solves WHERE id = $1', [Number(id)]);
    return { deleted: true };
  }

  async removeAll(userId?: string | null) {
    if (userId) {
      await this.pool.query('DELETE FROM practice_solves WHERE user_id = $1', [userId]);
    } else {
      await this.pool.query('DELETE FROM practice_solves WHERE user_id IS NULL');
    }
    return { cleared: true };
  }
}