import { Module } from '@nestjs/common';
import { RankedController } from './ranked.controller.js';
import { RankedService } from './ranked.service.js';
import { RankedGateway } from './ranked.gateway.js';

@Module({
  controllers: [RankedController],
  providers: [RankedService, RankedGateway],
})
export class RankedModule {}