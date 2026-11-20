import { Module } from '@nestjs/common';
import { SolvesController } from './solves.controller.js';
import { SolvesService } from './solves.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [SolvesController],
  providers: [SolvesService],
})
export class SolvesModule {}