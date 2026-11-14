import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class AppService {
  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  });

  async getHello() {
    const res = await this.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    return {
      message: 'NestJS đã kết nối thành công với PostgreSQL!',
      tables: res.rows.map((row) => row.table_name),
    };
  }
}