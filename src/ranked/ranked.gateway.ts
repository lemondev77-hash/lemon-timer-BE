import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface RoomPlayer {
  socketId: string;
  userId: string;
  name: string;
  elo: number;
  score: number;
}

interface MatchRoom {
  roomCode: string;
  event: string;
  bestOf: 3 | 5;
  round: number;
  scramble: string;
  players: RoomPlayer[];
  roundTimes: Record<string, number>;
}

function generateScramble(event: string): string {
  const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const faces =
    event === '222'
      ? ['U', 'R', 'F']
      : event === 'pyram' || event === 'skewb'
        ? ['U', 'L', 'R', 'B']
        : ['U', 'D', 'L', 'R', 'F', 'B'];
  const mods =
    event === 'pyram' || event === 'skewb' ? ['', "'"] : ['', "'", '2'];
  const len = event === '222' ? 9 : event === '444' ? 36 : 20;

  const moves: string[] = [];
  let last = '';
  for (let i = 0; i < len; i++) {
    const f = rand(faces.filter((x) => x !== last));
    last = f;
    moves.push(`${f}${rand(mods)}`);
  }
  return moves.join(' ');
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MatchGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private rooms = new Map<string, MatchRoom>();
  private socketToRoom = new Map<string, string>();
  private quickQueue = new Map<
    string,
    { socketId: string; userId: string; name: string; elo: number; event: string }
  >();

  handleDisconnect(client: Socket) {
    this.quickQueue.delete(client.id);

    const roomCode = this.socketToRoom.get(client.id);
    if (!roomCode) return;

    this.socketToRoom.delete(client.id);
    const room = this.rooms.get(roomCode);
    if (!room) return;

    client.to(roomCode).emit('opponent_left');
    this.rooms.delete(roomCode);
  }

  /** 1. Tạo phòng thi đấu riêng */
  @SubscribeMessage('create_room')
  handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    const roomCode = String(
      payload?.roomCode || Math.random().toString(36).substring(2, 8),
    )
      .trim()
      .toUpperCase();

    const event = String(payload?.event || '333');
    const bestOf: 3 | 5 = payload?.bestOf === 3 ? 3 : 5;

    const room: MatchRoom = {
      roomCode,
      event,
      bestOf,
      round: 1,
      scramble: generateScramble(event),
      players: [
        {
          socketId: client.id,
          userId: String(payload?.userId || client.id),
          name: String(payload?.name || 'Chủ phòng'),
          elo: Number(payload?.elo ?? 1200),
          score: 0,
        },
      ],
      roundTimes: {},
    };

    this.rooms.set(roomCode, room);
    this.socketToRoom.set(client.id, roomCode);
    client.join(roomCode);
    client.emit('room_created', { roomCode, event, bestOf });
    return { ok: true, roomCode };
  }

  /** 2. Vào phòng thi đấu bằng mã 6 ký tự */
  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    const roomCode = String(payload?.roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(roomCode);

    if (!room) {
      client.emit('room_error', {
        message: `Không tìm thấy phòng có mã ${roomCode}`,
      });
      return;
    }

    if (room.players.length >= 2) {
      client.emit('room_error', {
        message: 'Phòng này đã đủ 2 người chơi!',
      });
      return;
    }

    const joiner: RoomPlayer = {
      socketId: client.id,
      userId: String(payload?.userId || client.id),
      name: String(payload?.name || 'Đối thủ'),
      elo: Number(payload?.elo ?? 1200),
      score: 0,
    };

    room.players.push(joiner);
    this.socketToRoom.set(client.id, roomCode);
    client.join(roomCode);

    this.server.to(roomCode).emit('match_started', {
      roomCode: room.roomCode,
      event: room.event,
      bestOf: room.bestOf,
      round: room.round,
      scramble: room.scramble,
      players: room.players,
    });
  }

  /** 3. Ghép trận Rank ngẫu nhiên */
  @SubscribeMessage('find_match')
  handleFindMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    const event = String(payload?.event || '333');
    const userId = String(payload?.userId || client.id);
    const name = String(payload?.name || 'Cuber');
    const elo = Number(payload?.elo ?? 1200);

    let matchedEntry: {
      socketId: string;
      userId: string;
      name: string;
      elo: number;
      event: string;
    } | null = null;

    for (const [sockId, entry] of this.quickQueue.entries()) {
      if (sockId !== client.id && entry.event === event) {
        matchedEntry = entry;
        break;
      }
    }

    if (!matchedEntry) {
      this.quickQueue.set(client.id, {
        socketId: client.id,
        userId,
        name,
        elo,
        event,
      });
      return;
    }

    this.quickQueue.delete(matchedEntry.socketId);
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const scramble = generateScramble(event);

    const room: MatchRoom = {
      roomCode,
      event,
      bestOf: 5,
      round: 1,
      scramble,
      players: [
        {
          socketId: matchedEntry.socketId,
          userId: matchedEntry.userId,
          name: matchedEntry.name,
          elo: matchedEntry.elo,
          score: 0,
        },
        {
          socketId: client.id,
          userId,
          name,
          elo,
          score: 0,
        },
      ],
      roundTimes: {},
    };

    this.rooms.set(roomCode, room);
    this.socketToRoom.set(matchedEntry.socketId, roomCode);
    this.socketToRoom.set(client.id, roomCode);

    const opponentSocket = this.server.sockets.sockets.get(matchedEntry.socketId);
    opponentSocket?.join(roomCode);
    client.join(roomCode);

    this.server.to(roomCode).emit('match_started', {
      roomCode,
      event,
      bestOf: 5,
      round: 1,
      scramble,
      players: room.players,
    });
  }

  @SubscribeMessage('cancel_find_match')
  handleCancelFindMatch(@ConnectedSocket() client: Socket) {
    this.quickQueue.delete(client.id);
  }

  /** 4. Báo trạng thái đang bấm giờ cho đối thủ */
  @SubscribeMessage('player_solving')
  handlePlayerSolving(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    const roomCode = String(
      payload?.roomCode || this.socketToRoom.get(client.id) || '',
    ).toUpperCase();
    if (!roomCode) return;
    client.to(roomCode).emit('opponent_solving');
  }

  /** 5. Nộp thành tích mỗi ván & Tính điểm Bo3/Bo5 */
  @SubscribeMessage('submit_solve')
  handleSubmitSolve(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    const roomCode = String(
      payload?.roomCode || this.socketToRoom.get(client.id) || '',
    ).toUpperCase();
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const player =
      room.players.find((p) => p.socketId === client.id) ||
      room.players.find((p) => p.userId === String(payload?.userId));
    if (!player) return;

    const timeMs = Number(payload?.timeMs ?? 0);
    room.roundTimes[player.userId] = timeMs;

    client.to(roomCode).emit('opponent_finished', {
      userId: player.userId,
      timeMs,
    });

    // Chờ đủ cả 2 người nộp giờ
    if (room.players.length < 2) return;
    const [p1, p2] = room.players;
    const t1 = room.roundTimes[p1.userId];
    const t2 = room.roundTimes[p2.userId];
    if (t1 === undefined || t2 === undefined) return;

    let roundWinnerId: string | null = null;
    if (t1 < t2) {
      p1.score += 1;
      roundWinnerId = p1.userId;
    } else if (t2 < t1) {
      p2.score += 1;
      roundWinnerId = p2.userId;
    }

    const winTarget = Math.ceil(room.bestOf / 2);
    let matchWinnerId: string | null = null;
    const newElo: Record<string, number> = {};

    if (p1.score >= winTarget) {
      matchWinnerId = p1.userId;
      newElo[p1.userId] = p1.elo + 15;
      newElo[p2.userId] = Math.max(800, p2.elo - 15);
    } else if (p2.score >= winTarget) {
      matchWinnerId = p2.userId;
      newElo[p2.userId] = p2.elo + 15;
      newElo[p1.userId] = Math.max(800, p1.elo - 15);
    }

    const finishedScramble = room.scramble;
    const finishedRound = room.round;
    const roundTimesSnapshot = { ...room.roundTimes };

    if (matchWinnerId) {
      this.server.to(roomCode).emit('round_result', {
        round: finishedRound,
        scramble: finishedScramble,
        times: roundTimesSnapshot,
        scores: {
          [p1.userId]: p1.score,
          [p2.userId]: p2.score,
        },
        roundWinnerId,
        matchWinnerId,
        newElo,
      });

      this.socketToRoom.delete(p1.socketId);
      this.socketToRoom.delete(p2.socketId);
      this.rooms.delete(roomCode);
      return;
    }

    // Sang ván tiếp theo
    room.round += 1;
    room.roundTimes = {};
    room.scramble = generateScramble(room.event);

    this.server.to(roomCode).emit('round_result', {
      round: finishedRound,
      scramble: finishedScramble,
      times: roundTimesSnapshot,
      scores: {
        [p1.userId]: p1.score,
        [p2.userId]: p2.score,
      },
      roundWinnerId,
      matchWinnerId: null,
      nextRound: room.round,
      nextScramble: room.scramble,
    });
  }

  /** 6. Rời phòng chủ động */
  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    const roomCode = String(
      payload?.roomCode || this.socketToRoom.get(client.id) || '',
    ).toUpperCase();
    if (!roomCode) return;

    client.leave(roomCode);
    this.socketToRoom.delete(client.id);
    client.to(roomCode).emit('opponent_left');
    this.rooms.delete(roomCode);
  }
}