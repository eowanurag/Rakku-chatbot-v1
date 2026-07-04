import { Module } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { EmergencyService } from './emergency.service';
import { EmergencyRepository } from './emergency.repository';
import { EmergencyGateway } from './emergency.gateway';
import { DashboardNotifier, TelegramNotifier, EmailNotifier } from './emergency.notifiers';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [EmergencyController],
  providers: [
    EmergencyService,
    EmergencyRepository,
    EmergencyGateway,
    DashboardNotifier,
    TelegramNotifier,
    EmailNotifier,
    PrismaService
  ],
  exports: [EmergencyService]
})
export class EmergencyModule {}
