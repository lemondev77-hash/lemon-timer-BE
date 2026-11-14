import { Module } from '@nestjs/common';
import { SolvesController } from './solves.controller.js';
import { SolvesService } from './solves.service.js';

@Module({
  controllers: [SolvesController],
  providers: [SolvesService],
})
export class SolvesModule {}