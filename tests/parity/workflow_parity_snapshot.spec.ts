import { ChatService } from '@backend/chat/chat.service';
import { PrismaService } from '@backend/prisma.service';
import { ValidationService } from '@backend/chat/validation.service';
import { ComplaintService } from '@backend/complaint/complaint.service';
import { VerificationService } from '@backend/verification/verification.service';
import { CertificateService } from '@backend/certificate/certificate.service';
import { EventService } from '@backend/event/event.service';
import { TrackingService } from '@backend/tracking/tracking.service';
import { AnalyticsService } from '@backend/citizen-assistance/analytics.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { IntelligenceService } from '@backend/citizen-assistance/intelligence.service';
import { throwError } from 'rxjs';

describe('Workflow Parity Snapshot Tests', () => {
  let chatService: ChatService;
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = new PrismaService();
    const config = new ConfigService();
    const validation = new ValidationService();
    const complaint = new ComplaintService(prisma);
    const verification = new VerificationService(prisma);
    const certificate = new CertificateService(prisma);
    const event = new EventService(prisma);
    const tracking = new TrackingService(prisma);
    const intelligence = new IntelligenceService(prisma);
    const analytics = new AnalyticsService();

    const httpService = new HttpService();
    httpService.post = () => throwError(() => new Error('Forced connection failure for testing')) as any;

    chatService = new ChatService(
      httpService,
      config,
      complaint,
      verification,
      certificate,
      event,
      tracking,
      analytics,
      prisma,
      validation,
      intelligence
    );
  });

  beforeEach(async () => {
    const testMobiles = ['7878787878'];
    const testCitizenIds = (await prisma.citizen.findMany({
      where: { mobileNumber: { in: testMobiles } }
    })).map(c => c.id);
    
    if (testCitizenIds.length > 0) {
      await prisma.complaint.deleteMany({ where: { citizenId: { in: testCitizenIds } } });
      await prisma.verification.deleteMany({ where: { citizenId: { in: testCitizenIds } } });
      await prisma.characterCertificate.deleteMany({ where: { citizenId: { in: testCitizenIds } } });
      await prisma.eventPermission.deleteMany({ where: { citizenId: { in: testCitizenIds } } });
      await prisma.notification.deleteMany({ where: { citizenId: { in: testCitizenIds } } });
      await prisma.citizenFeedback.deleteMany({ where: { citizenId: { in: testCitizenIds } } });
      await prisma.citizen.deleteMany({ where: { id: { in: testCitizenIds } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const runInputs = async (inputs: string[]) => {
    const sessionId = 'parity-snap-' + Math.random().toString(36).substring(7);
    const responses: string[] = [];
    for (const input of inputs) {
      const result = await chatService.sendMessage(input, sessionId);
      responses.push(result.response);
    }
    return responses;
  };

  it('should match snapshot for Lost Mobile workflow', async () => {
    const responses = await runInputs([
      "english",
      "File Complaint",
      "7878787878",
      "Manoj Tiwari",
      "Ayodhya",
      "Confirm",
      "House No 22 Civil Lines",
      "Confirm Details",
      "Lost Mobile",
      "Samsung",
      "M34",
      "Black",
      "2023",
      "Skip",
      "Ayodhya",
      "10/06/2026",
      "Lost mobile phone near temple"
    ]);

    // Snapshot the review screen output
    const reviewScreen = responses[responses.length - 1];
    expect(reviewScreen).toMatchSnapshot();
  }, 30000);

  it('should match snapshot for Application Tracking', async () => {
    const responses = await runInputs([
      "english",
      "Track Application",
      "UP-CMP-2026-123456"
    ]);

    const result = responses[responses.length - 1];
    expect(result).toMatchSnapshot();
  }, 10000);
});
