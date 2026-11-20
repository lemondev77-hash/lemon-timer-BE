import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
} from '@nestjs/common';
import { SolvesService } from './solves.service.js';
import { AuthService } from '../auth/auth.service.js';

@Controller('solves')
export class SolvesController {
  constructor(
    private readonly solvesService: SolvesService,
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

  @Get()
  findAll(
    @Query('userId') userId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(userId, authHeader);
    return this.solvesService.findAll(effectiveUserId);
  }

  @Post()
  create(
    @Body()
    body: {
      timeMs: number;
      scramble: string;
      penalty?: 'NONE' | '+2' | 'DNF';
      userId?: string | null;
      event?: string;
      sessionId?: string;
    },
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(body.userId, authHeader);
    return this.solvesService.create(
      body.timeMs,
      body.scramble,
      body.penalty ?? 'NONE',
      effectiveUserId,
      body.event ?? '333',
      body.sessionId ?? 'session_1',
    );
  }

  @Patch(':id/penalty')
  updatePenalty(
    @Param('id') id: string,
    @Body() body: { penalty: 'NONE' | '+2' | 'DNF' },
  ) {
    return this.solvesService.updatePenalty(id, body.penalty);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.solvesService.remove(id);
  }

  @Delete()
  removeAll(
    @Query('userId') userId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const effectiveUserId = this.resolveUserId(userId, authHeader);
    return this.solvesService.removeAll(effectiveUserId);
  }
}