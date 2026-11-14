import { Injectable, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

@Injectable()
export class RankedService implements OnModuleInit {
  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  });

  async onModuleInit() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ranked_matches (
        id TEXT PRIMARY KEY,
        player1_id TEXT NOT NULL,
        player2_id TEXT NOT NULL,
        player1_score INTEGER NOT NULL DEFAULT 0,
        player2_score INTEGER NOT NULL DEFAULT 0,
        winner_id TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await this.pool.query(`
      ALTER TABLE ranked_matches
      ADD COLUMN IF NOT EXISTS elo_delta INTEGER NOT NULL DEFAULT 0;
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS match_rounds (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES ranked_matches(id) ON DELETE CASCADE,
        round_number INTEGER NOT NULL,
        scramble TEXT NOT NULL,
        winner_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS match_solves (
        id TEXT PRIMARY KEY,
        round_id TEXT NOT NULL REFERENCES match_rounds(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        time_ms INTEGER NOT NULL,
        penalty VARCHAR(10) NOT NULL DEFAULT 'NONE',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  generateScramble3x3(): string {
    const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
    const modifiers = ['', "'", '2'];
    const axis: Record<string, number> = { U: 0, D: 0, L: 1, R: 1, F: 2, B: 2 };

    const moves: string[] = [];
    let lastFace = '';
    let secondLastFace = '';

    while (moves.length < 20) {
      const face = faces[Math.floor(Math.random() * faces.length)];
      if (face === lastFace) continue;
      if (secondLastFace && axis[face] === axis[lastFace] && face === secondLastFace) {
        continue;
      }
      const mod = modifiers[Math.floor(Math.random() * modifiers.length)];
      moves.push(`${face}${mod}`);
      secondLastFace = lastFace;
      lastFace = face;
    }
    return moves.join(' ');
  }

  async createMatch(player1Id: string, player2Id: string) {
    const matchId = randomUUID();
    const roundId = randomUUID();
    const scramble = this.generateScramble3x3();

    await this.pool.query(
      `INSERT INTO ranked_matches (id, player1_id, player2_id, status)
       VALUES ($1, $2, $3, 'IN_PROGRESS')`,
      [matchId, player1Id, player2Id],
    );

    await this.pool.query(
      `INSERT INTO match_rounds (id, match_id, round_number, scramble)
       VALUES ($1, $2, 1, $3)`,
      [roundId, matchId, scramble],
    );

    return { matchId, roundId, roundNumber: 1, scramble };
  }

  async createNextRound(matchId: string, roundNumber: number) {
    const roundId = randomUUID();
    const scramble = this.generateScramble3x3();

    await this.pool.query(
      `INSERT INTO match_rounds (id, match_id, round_number, scramble)
       VALUES ($1, $2, $3, $4)`,
      [roundId, matchId, roundNumber, scramble],
    );

    return { roundId, roundNumber, scramble };
  }

  async saveRoundResult(
    matchId: string,
    roundId: string,
    p1: { userId: string; timeMs: number; penalty: string },
    p2: { userId: string; timeMs: number; penalty: string },
    roundWinnerId: string | null,
    p1Score: number,
    p2Score: number,
  ) {
    await this.pool.query(
      `INSERT INTO match_solves (id, round_id, user_id, time_ms, penalty)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9)`,
      [
        randomUUID(),
        roundId,
        p1.userId,
        p1.timeMs,
        p1.penalty,
        randomUUID(),
        p2.userId,
        p2.timeMs,
        p2.penalty,
      ],
    );

    await this.pool.query('UPDATE match_rounds SET winner_id = $1 WHERE id = $2', [
      roundWinnerId,
      roundId,
    ]);

    await this.pool.query(
      'UPDATE ranked_matches SET player1_score = $1, player2_score = $2 WHERE id = $3',
      [p1Score, p2Score, matchId],
    );
  }

  async finalizeMatchAndElo(
    matchId: string,
    winnerId: string,
    loserId: string,
    winnerElo: number,
    loserElo: number,
  ) {
    const K = 32;
    const expectedWin = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const delta = Math.max(8, Math.round(K * (1 - expectedWin)));

    const newWinnerElo = winnerElo + delta;
    const newLoserElo = Math.max(100, loserElo - delta);

    await this.pool.query(
      `UPDATE ranked_matches SET status = 'COMPLETED', winner_id = $1 WHERE id = $2`,
      [winnerId, matchId],
    );
    await this.pool.query(
      `UPDATE ranked_matches
       SET status = 'COMPLETED', winner_id = $1, elo_delta = $3
       WHERE id = $2`,
      [winnerId, matchId, delta],
    );

    await this.pool.query(
      `UPDATE player_ratings
       SET elo = $1, wins = wins + 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [newWinnerElo, winnerId],
    );

    await this.pool.query(
      `UPDATE player_ratings
       SET elo = $1, losses = losses + 1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [newLoserElo, loserId],
    );

    return { delta, newWinnerElo, newLoserElo };
  }

  async getLeaderboard() {
    const res = await this.pool.query(`
      SELECT u.id, u.username, r.elo, r.wins, r.losses
      FROM player_ratings r
      JOIN users u ON u.id = r.user_id
      ORDER BY r.elo DESC, r.wins DESC
      LIMIT 20
    `);
    return res.rows.map((r) => ({
      id: r.id,
      username: r.username,
      elo: Number(r.elo),
      wins: Number(r.wins),
      losses: Number(r.losses),
    }));
  }
  async getMatchHistory(userId: string) {
    const res = await this.pool.query(
      `SELECT m.id,
              m.player1_id,
              m.player2_id,
              m.player1_score,
              m.player2_score,
              m.winner_id,
              m.elo_delta,
              m.created_at,
              u1.username AS p1_name,
              u2.username AS p2_name
       FROM ranked_matches m
       LEFT JOIN users u1 ON u1.id = m.player1_id
       LEFT JOIN users u2 ON u2.id = m.player2_id
       WHERE (m.player1_id = $1 OR m.player2_id = $1)
         AND m.status = 'COMPLETED'
       ORDER BY m.created_at DESC
       LIMIT 20`,
      [userId],
    );

    return res.rows.map((r) => {
      const isP1 = r.player1_id === userId;
      const oppId = isP1 ? r.player2_id : r.player1_id;
      const rawOppName = isP1 ? r.p2_name : r.p1_name;
      const opponentName =
        oppId === 'bot_ai' ? 'LemonBot (AI)' : rawOppName || 'Cuber Ẩn danh';

      return {
        id: r.id,
        opponentName,
        myScore: Number(isP1 ? r.player1_score : r.player2_score),
        oppScore: Number(isP1 ? r.player2_score : r.player1_score),
        won: r.winner_id === userId,
        eloDelta: Number(r.elo_delta ?? 0),
        createdAt: new Date(r.created_at).getTime(),
      };
    });
  }
}