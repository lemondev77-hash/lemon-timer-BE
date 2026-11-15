import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'lemon_timer_super_secret_jwt_key_2026';

@Injectable()
export class AuthService implements OnModuleInit {
  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
  });

  async onModuleInit() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar VARCHAR(50) NOT NULL DEFAULT 'cube_blue',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS avatar VARCHAR(50) NOT NULL DEFAULT 'cube_blue';
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS player_ratings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        elo INTEGER NOT NULL DEFAULT 1000,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  signJwt(payload: Record<string, any>, expiresInSeconds = 30 * 24 * 3600): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + expiresInSeconds;
    const fullPayload = { ...payload, iat, exp };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const signature = createHmac('sha256', JWT_SECRET)
      .update(dataToSign)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${dataToSign}.${signature}`;
  }

  verifyJwt(token: string): Record<string, any> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [headerB64, payloadB64, signature] = parts;
      const dataToSign = `${headerB64}.${payloadB64}`;

      const expectedSig = createHmac('sha256', JWT_SECRET)
        .update(dataToSign)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      if (signature !== expectedSig) return null;

      const payload = JSON.parse(this.base64UrlDecode(payloadB64));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    const [salt, keyHex] = storedHash.split(':');
    if (!salt || !keyHex) return false;
    const derivedKey = scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(keyHex, 'hex');
    if (derivedKey.length !== keyBuffer.length) return false;
    return timingSafeEqual(derivedKey, keyBuffer);
  }

  async register(username: string, password: string) {
    const cleanName = (username ?? '').trim();
    const cleanPass = password ?? '';

    if (cleanName.length < 3 || cleanPass.length < 4) {
      throw new BadRequestException('Tên tối thiểu 3 ký tự và mật khẩu tối thiểu 4 ký tự');
    }

    try {
      const exists = await this.pool.query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
        [cleanName],
      );
      if (exists.rowCount && exists.rowCount > 0) {
        throw new BadRequestException('Tên Cuber này đã có người sử dụng');
      }

      const id = randomUUID();
      const hash = this.hashPassword(cleanPass);

      await this.pool.query(
        `INSERT INTO users (id, username, password_hash, avatar)
         VALUES ($1, $2, $3, 'cube_blue')`,
        [id, cleanName, hash],
      );
      await this.pool.query(
        'INSERT INTO player_ratings (user_id, elo, wins, losses) VALUES ($1, 1000, 0, 0)',
        [id],
      );

      const user = {
        id,
        username: cleanName,
        avatar: 'cube_blue',
        elo: 1000,
        wins: 0,
        losses: 0,
      };

      const token = this.signJwt({ sub: id, username: cleanName });

      return {
        token,
        user,
        ...user,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      console.error('Lỗi đăng ký tài khoản:', err);
      throw new InternalServerErrorException(
        err instanceof Error ? err.message : 'Lỗi lưu dữ liệu vào PostgreSQL',
      );
    }
  }

  async login(username: string, password: string) {
    const cleanName = (username ?? '').trim();
    const cleanPass = password ?? '';

    if (!cleanName || !cleanPass) {
      throw new BadRequestException('Vui lòng nhập đầy đủ tên và mật khẩu');
    }

    try {
      const res = await this.pool.query(
        `SELECT u.id, u.username, u.password_hash,
                COALESCE(u.avatar, 'cube_blue') AS avatar,
                COALESCE(r.elo, 1000) AS elo,
                COALESCE(r.wins, 0) AS wins,
                COALESCE(r.losses, 0) AS losses
         FROM users u
         LEFT JOIN player_ratings r ON r.user_id = u.id
         WHERE LOWER(u.username) = LOWER($1)`,
        [cleanName],
      );

      const userRow = res.rows[0];
      if (!userRow || !this.verifyPassword(cleanPass, userRow.password_hash)) {
        throw new UnauthorizedException('Sai tên đăng nhập hoặc mật khẩu');
      }

      const user = {
        id: userRow.id,
        username: userRow.username,
        avatar: userRow.avatar,
        elo: Number(userRow.elo),
        wins: Number(userRow.wins),
        losses: Number(userRow.losses),
      };

      const token = this.signJwt({ sub: user.id, username: user.username });

      return {
        token,
        user,
        ...user,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof BadRequestException) {
        throw err;
      }
      console.error('Lỗi đăng nhập:', err);
      throw new InternalServerErrorException('Lỗi truy vấn PostgreSQL');
    }
  }

  async getProfile(userId: string) {
    const res = await this.pool.query(
      `SELECT u.id, u.username,
              COALESCE(u.avatar, 'cube_blue') AS avatar,
              COALESCE(r.elo, 1000) AS elo,
              COALESCE(r.wins, 0) AS wins,
              COALESCE(r.losses, 0) AS losses
       FROM users u
       LEFT JOIN player_ratings r ON r.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      username: row.username,
      avatar: row.avatar,
      elo: Number(row.elo),
      wins: Number(row.wins),
      losses: Number(row.losses),
    };
  }

  async getMe(authHeader?: string) {
    if (!authHeader) {
      throw new UnauthorizedException('Chưa cung cấp thông tin xác thực');
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const payload = this.verifyJwt(token);
    const userId = payload?.sub || token;

    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new UnauthorizedException('Tài khoản không tồn tại hoặc phiên hết hạn');
    }
    return profile;
  }

  async updateAvatar(userId: string, avatar: string) {
    const cleanAvatar = (avatar ?? '').trim() || 'cube_blue';
    const res = await this.pool.query(
      'UPDATE users SET avatar = $1 WHERE id = $2 RETURNING id, avatar',
      [cleanAvatar, userId],
    );
    if (!res.rows[0]) {
      throw new BadRequestException('Không tìm thấy tài khoản');
    }
    return { id: res.rows[0].id, avatar: res.rows[0].avatar };
  }
}