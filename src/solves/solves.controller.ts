import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { SolvesService } from './solves.service.js';

@Controller('solves')
export class SolvesController {
  constructor(private readonly solvesService: SolvesService) {}

  @Get()
  findAll(@Query('userId') userId?: string) {
    return this.solvesService.findAll(userId);
  }

  @Post()
  create(
    @Body()
    body: {
      timeMs: number;
      scramble: string;
      penalty?: 'NONE' | '+2' | 'DNF';
      userId?: string | null;
    },
  ) {
    return this.solvesService.create(
      body.timeMs,
      body.scramble,
      body.penalty ?? 'NONE',
      body.userId ?? null,
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
  removeAll(@Query('userId') userId?: string) {
    return this.solvesService.removeAll(userId);
  }
}