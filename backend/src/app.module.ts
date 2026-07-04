import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { PrismaService } from './prisma.service';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { SubmissionFingerprintService } from './security/submission-fingerprint.service';

// Citizen Assistance
import { CitizenAssistanceModule } from './citizen-assistance/citizen-assistance.module';

// Complaints
import { ComplaintController } from './complaint/complaint.controller';
import { ComplaintService } from './complaint/complaint.service';

// Verifications
import { VerificationController } from './verification/verification.controller';
import { VerificationService } from './verification/verification.service';

// Character Certificates
import { CertificateController } from './certificate/certificate.controller';
import { CertificateService } from './certificate/certificate.service';

// Event Permissions
import { EventController } from './event/event.controller';
import { EventService } from './event/event.service';

// Tracking
import { TrackingController } from './tracking/tracking.controller';
import { TrackingService } from './tracking/tracking.service';

// Chat Assistant
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { ValidationService } from './chat/validation.service';

// Knowledge
import { KnowledgeController } from './knowledge/knowledge.controller';
import { KnowledgeService } from './knowledge/knowledge.service';
import { IntelligenceService } from './citizen-assistance/intelligence.service';

import { LocalizationModule } from './localization/localization.module';
import { JurisdictionRoutingModule } from './jurisdiction-routing/jurisdiction-routing.module';
import { NotificationModule } from './notification/notification.module';
import { EmergencyModule } from './emergency/emergency.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    HttpModule,
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 60,
    }]),
    CitizenAssistanceModule,
    LocalizationModule,
    JurisdictionRoutingModule,
    NotificationModule,
    EmergencyModule,
  ],
  controllers: [
    ComplaintController,
    VerificationController,
    CertificateController,
    EventController,
    TrackingController,
    ChatController,
    KnowledgeController,
  ],
  providers: [
    PrismaService,
    ComplaintService,
    VerificationService,
    CertificateService,
    EventService,
    TrackingService,
    ChatService,
    ValidationService,
    KnowledgeService,
    IntelligenceService,
    SubmissionFingerprintService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  exports: [SubmissionFingerprintService],
})
export class AppModule {}

