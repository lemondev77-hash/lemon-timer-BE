import { Controller, Get, Post, Param } from '@nestjs/common';
import { LearningService } from './learning.service.js';

@Controller('learning')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  getLearnedIds() {
    return this.learningService.getLearnedIds();
  }

  @Post(':algoId/toggle')
  toggleAlgorithm(@Param('algoId') algoId: string) {
    return this.learningService.toggleAlgorithm(algoId);
  }
}