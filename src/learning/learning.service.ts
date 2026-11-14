import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class LearningService implements OnModuleInit {
  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  });

  async onModuleInit() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS learned_algorithms (
        algo_id VARCHAR(50) PRIMARY KEY,
        learned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async getLearnedIds(): Promise<string[]> {
    const res = await this.pool.query(
      'SELECT algo_id FROM learned_algorithms ORDER BY learned_at DESC',
    );
    return res.rows.map((row) => row.algo_id);
  }

  async toggleAlgorithm(algoId: string): Promise<{ algoId: string; learned: boolean }> {
    const deleted = await this.pool.query(
      'DELETE FROM learned_algorithms WHERE algo_id = $1 RETURNING algo_id',
      [algoId],
    );

    if (deleted.rowCount && deleted.rowCount > 0) {
      return { algoId, learned: false };
    }

    await this.pool.query(
      'INSERT INTO learned_algorithms (algo_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [algoId],
    );
    return { algoId, learned: true };
  }
}