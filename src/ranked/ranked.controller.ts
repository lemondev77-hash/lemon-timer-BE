import { Controller, Get, Param } from '@nestjs/common';
import { RankedService } from './ranked.service.js';

@Controller('ranked')
export class RankedController {
  constructor(private readonly rankedService: RankedService) {}

  @Get('leaderboard')
  getLeaderboard() {
    return this.rankedService.getLeaderboard();
  }

  @Get('history/:userId')
  getHistory(@Param('userId') userId: string) {
    return this.rankedService.getMatchHistory(userId);
  }
}