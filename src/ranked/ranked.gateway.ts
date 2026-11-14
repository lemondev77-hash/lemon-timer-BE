import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RankedService } from './ranked.service.js';

interface QueuedPlayer {
  socketId: string;
  userId: string;
  username: string;
  elo: number;
}

interface ActiveSubmission {
  timeMs: number;
  penalty: 'NONE' | '+2' | 'DNF';
}

interface ActiveMatch {
  
  matchId: string;
  roundId: string;
  roundNumber: number;
  scramble: string;
  player1: QueuedPlayer & { score: number; status: string };
  player2: QueuedPlayer & { score: number; status: string };
  submissions: Record<string, ActiveSubmission>;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class RankedGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private queue: QueuedPlayer[] = [];
  private activeMatches = new Map<string, ActiveMatch>();
  private botTimers = new Map<string, NodeJS.Timeout[]>();

  constructor(private readonly rankedService: RankedService) {}

  private clearBotTimers(matchId: string) {
    const timers = this.botTimers.get(matchId);
    if (timers) {
      timers.forEach((t) => clearTimeout(t));
      this.botTimers.delete(matchId);
    }
  }

  private scheduleBotTurn(matchId: string) {
    this.clearBotTimers(matchId);
    const botSolveMs = Math.floor(11000 + Math.random() * 7000); // Bot giải từ 11s - 18s

    const t1 = setTimeout(() => {
      if (!this.activeMatches.has(matchId)) return;
      this.server.to(matchId).emit('opponent_status', {
        userId: 'bot_ai',
        status: 'INSPECTING',
      });
    }, 1500);

    const t2 = setTimeout(() => {
      if (!this.activeMatches.has(matchId)) return;
      this.server.to(matchId).emit('opponent_status', {
        userId: 'bot_ai',
        status: 'SOLVING',
      });
    }, 4500);

    const t3 = setTimeout(() => {
      if (!this.activeMatches.has(matchId)) return;
      this.handleSubmitSolve({
        matchId,
        userId: 'bot_ai',
        timeMs: botSolveMs,
        penalty: 'NONE',
      });
    }, 4500 + botSolveMs);

    this.botTimers.set(matchId, [t1, t2, t3]);
  }

  @SubscribeMessage('join_bot_match')
  async handleJoinBotMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId: string; username: string; elo: number },
  ) {
    const created = await this.rankedService.createMatch(payload.userId, 'bot_ai');

    const match: ActiveMatch = {
      matchId: created.matchId,
      roundId: created.roundId,
      roundNumber: 1,
      scramble: created.scramble,
      player1: {
        socketId: client.id,
        userId: payload.userId,
        username: payload.username,
        elo: payload.elo,
        score: 0,
        status: 'READY',
      },
      player2: {
        socketId: 'bot',
        userId: 'bot_ai',
        username: 'LemonBot (AI)',
        elo: payload.elo,
        score: 0,
        status: 'READY',
      },
      submissions: {},
    };

    this.activeMatches.set(match.matchId, match);
    client.join(match.matchId);

    client.emit('match_found', {
      matchId: match.matchId,
      roundNumber: 1,
      scramble: match.scramble,
      player1: {
        userId: match.player1.userId,
        username: match.player1.username,
        elo: match.player1.elo,
        score: 0,
      },
      player2: {
        userId: match.player2.userId,
        username: match.player2.username,
        elo: match.player2.elo,
        score: 0,
      },
    });

    this.scheduleBotTurn(match.matchId);
  }

  private getEffectiveMs(sub: ActiveSubmission): number {
    if (sub.penalty === 'DNF') return Number.MAX_SAFE_INTEGER;
    return sub.penalty === '+2' ? sub.timeMs + 2000 : sub.timeMs;
  }

  @SubscribeMessage('join_queue')
  async handleJoinQueue(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId: string; username: string; elo: number },
  ) {
    // Loại bỏ nếu user này đang nằm sẵn trong hàng chờ
    this.queue = this.queue.filter(
      (p) => p.userId !== payload.userId && p.socketId !== client.id,
    );

    const player: QueuedPlayer = {
      socketId: client.id,
      userId: payload.userId,
      username: payload.username,
      elo: payload.elo,
    };

    if (this.queue.length === 0) {
      this.queue.push(player);
      client.emit('queue_waiting', { position: 1 });
      return;
    }

    // Ghép cặp với người đang chờ lâu nhất
    const opponent = this.queue.shift()!;
    const created = await this.rankedService.createMatch(
      opponent.userId,
      player.userId,
    );

    const match: ActiveMatch = {
      matchId: created.matchId,
      roundId: created.roundId,
      roundNumber: 1,
      scramble: created.scramble,
      player1: { ...opponent, score: 0, status: 'READY' },
      player2: { ...player, score: 0, status: 'READY' },
      submissions: {},
    };

    this.activeMatches.set(match.matchId, match);


    const oppSocket = this.server.sockets.sockets.get(opponent.socketId);
    oppSocket?.join(match.matchId);
    client.join(match.matchId);

    this.server.to(match.matchId).emit('match_found', {
      matchId: match.matchId,
      roundNumber: 1,
      scramble: match.scramble,
      player1: {
        userId: match.player1.userId,
        username: match.player1.username,
        elo: match.player1.elo,
        score: 0,
      },
      player2: {
        userId: match.player2.userId,
        username: match.player2.username,
        elo: match.player2.elo,
        score: 0,
      },
    });
  }

  @SubscribeMessage('leave_queue')
  handleLeaveQueue(@ConnectedSocket() client: Socket) {
    this.queue = this.queue.filter((p) => p.socketId !== client.id);
    client.emit('queue_left');
  }

  @SubscribeMessage('player_status')
  handlePlayerStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchId: string; userId: string; status: string },
  ) {
    client.to(payload.matchId).emit('opponent_status', {
      userId: payload.userId,
      status: payload.status,
    });
  }

  @SubscribeMessage('submit_solve')
  async handleSubmitSolve(
    @MessageBody()
    payload: {
      matchId: string;
      userId: string;
      timeMs: number;
      penalty: 'NONE' | '+2' | 'DNF';
    },
  ) {
    const match = this.activeMatches.get(payload.matchId);
    if (!match) return;

    match.submissions[payload.userId] = {
      timeMs: payload.timeMs,
      penalty: payload.penalty,
    };

    // Báo cho đối thủ biết người này đã hoàn thành ván
    this.server.to(match.matchId).emit('opponent_status', {
      userId: payload.userId,
      status: 'SUBMITTED',
    });

    const p1Sub = match.submissions[match.player1.userId];
    const p2Sub = match.submissions[match.player2.userId];

    // Chờ cả 2 người cùng nộp kết quả ván hiện tại
    if (!p1Sub || !p2Sub) return;

    const p1Eff = this.getEffectiveMs(p1Sub);
    const p2Eff = this.getEffectiveMs(p2Sub);

    let roundWinnerId: string | null = null;
    if (p1Eff < p2Eff) {
      match.player1.score += 1;
      roundWinnerId = match.player1.userId;
    } else if (p2Eff < p1Eff) {
      match.player2.score += 1;
      roundWinnerId = match.player2.userId;
    }

    await this.rankedService.saveRoundResult(
      match.matchId,
      match.roundId,
      { userId: match.player1.userId, ...p1Sub },
      { userId: match.player2.userId, ...p2Sub },
      roundWinnerId,
      match.player1.score,
      match.player2.score,
    );

    const roundSummary = {
      roundNumber: match.roundNumber,
      roundWinnerId,
      p1Result: { userId: match.player1.userId, ...p1Sub },
      p2Result: { userId: match.player2.userId, ...p2Sub },
      p1Score: match.player1.score,
      p2Score: match.player2.score,
    };

    // Kiểm tra điều kiện thắng Bo5 (chạm 3 điểm trước)
    if (match.player1.score >= 3 || match.player2.score >= 3) {
      const p1Won = match.player1.score >= 3;
      const winner = p1Won ? match.player1 : match.player2;
      const loser = p1Won ? match.player2 : match.player1;

      const eloRes = await this.rankedService.finalizeMatchAndElo(
        match.matchId,
        winner.userId,
        loser.userId,
        winner.elo,
        loser.elo,
      );

      this.server.to(match.matchId).emit('match_ended', {
        ...roundSummary,
        winnerId: winner.userId,
        winnerName: winner.username,
        eloDelta: eloRes.delta,
        newElos: {
          [winner.userId]: eloRes.newWinnerElo,
          [loser.userId]: eloRes.newLoserElo,
        },
      });

      this.activeMatches.delete(match.matchId);
      return;
    }

    // Chưa ai chạm 3 điểm -> Sinh Scramble cho ván kế tiếp
    const nextRoundNumber = match.roundNumber + 1;
    const nextRound = await this.rankedService.createNextRound(
      match.matchId,
      nextRoundNumber,
    );

    match.roundNumber = nextRoundNumber;
    match.roundId = nextRound.roundId;
    match.scramble = nextRound.scramble;
    match.submissions = {};

    this.server.to(match.matchId).emit('next_round', {
      ...roundSummary,
      nextRoundNumber,
      nextScramble: nextRound.scramble,
    });
  }

  async handleDisconnect(client: Socket) {
    // Xóa khỏi hàng chờ nếu thoát app lúc tìm trận
    this.queue = this.queue.filter((p) => p.socketId !== client.id);
    
    // Nếu thoát giữa trận -> Xử thua đối thủ thoát và cộng Elo cho người ở lại
    for (const [matchId, match] of this.activeMatches.entries()) {
      const isP1 = match.player1.socketId === client.id;
      const isP2 = match.player2.socketId === client.id;
      if (!isP1 && !isP2) continue;

      const winner = isP1 ? match.player2 : match.player1;
      const loser = isP1 ? match.player1 : match.player2;

      const eloRes = await this.rankedService.finalizeMatchAndElo(
        matchId,
        winner.userId,
        loser.userId,
        winner.elo,
        loser.elo,
      );

      this.server.to(matchId).emit('match_ended', {
        roundNumber: match.roundNumber,
        roundWinnerId: winner.userId,
        p1Score: match.player1.score,
        p2Score: match.player2.score,
        winnerId: winner.userId,
        winnerName: winner.username,
        forfeit: true,
        eloDelta: eloRes.delta,
        newElos: {
          [winner.userId]: eloRes.newWinnerElo,
          [loser.userId]: eloRes.newLoserElo,
        },
      });

      if (match.player2.userId === 'bot_ai') {
  this.scheduleBotTurn(match.matchId);
}
      break;
    }
  }
}