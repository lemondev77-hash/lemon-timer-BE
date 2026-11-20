import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { SessionsService } from './sessions.service.js';
import { AuthService } from '../auth/auth.service.js';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly authService: AuthService,
  ) {}

  private resolveUserId(
    queryOrBodyUserId?: string | null,
    authHeader?: string,
  ): string | null {
    if (
      queryOrBodyUserId &&
      queryOrBodyUserId.trim() &&
      queryOrBodyUserId !== 'null' &&
      queryOrBodyUserId !== 'undefined'
    ) {
      return queryOrBodyUserId.trim();
    }
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const payload = this.authService.verifyJwt(token);
      if (payload && payload.sub) {
        return String(payload.sub);
      }
    }
    return null;
  }

  /** GET /sessions?userId=xxx  — Lấy danh sách sessions của user */
  @Get()
  async findAll(
    @Query('userId') userId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(userId, authHeader);
    if (!effectiveUserId) {
      return [];
    }
    return this.sessionsService.findAll(effectiveUserId);
  }

  /** PUT /sessions  — Đồng bộ toàn bộ sessions (gửi mảng lên, server thay thế hết) */
  @Put()
  async syncAll(
    @Body()
    body: {
      userId?: string;
      sessions: { id: string; name: string; event?: string; createdAt?: string }[];
    },
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(body.userId, authHeader);
    if (!effectiveUserId) {
      throw new BadRequestException('userId is required');
    }
    return this.sessionsService.syncAll(effectiveUserId, body.sessions || []);
  }

  /** POST /sessions  — Tạo 1 session mới */
  @Post()
  async create(
    @Body()
    body: {
      userId?: string;
      sessionId: string;
      name: string;
      event?: string;
      createdAt?: string;
    },
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(body.userId, authHeader);
    if (!effectiveUserId) {
      throw new BadRequestException('userId is required');
    }
    return this.sessionsService.create(
      effectiveUserId,
      body.sessionId,
      body.name,
      body.event,
      body.createdAt,
    );
  }

  /** PATCH /sessions/:sessionId  — Đổi tên session */
  @Patch(':sessionId')
  async rename(
    @Param('sessionId') sessionId: string,
    @Body() body: { userId?: string; name: string },
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(body.userId, authHeader);
    if (!effectiveUserId) {
      throw new BadRequestException('userId is required');
    }
    return this.sessionsService.rename(effectiveUserId, sessionId, body.name);
  }

  /** DELETE /sessions/:sessionId?userId=xxx  — Xóa session */
  @Delete(':sessionId')
  async remove(
    @Param('sessionId') sessionId: string,
    @Query('userId') userId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(userId, authHeader);
    if (!effectiveUserId) {
      throw new BadRequestException('userId is required');
    }
    return this.sessionsService.remove(effectiveUserId, sessionId);
  }
}
