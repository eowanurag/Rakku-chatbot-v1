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

describe('Feedback Regression Test Suite', () => {
  let chatService: ChatService;
  let prisma: PrismaService;

  beforeAll(async () => {
    jest.setTimeout(30000);
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
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

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const getNewSession = () => 'feedback-test-' + Math.random().toString(36).substring(7);

  it('should capture feedback in local fallback engine and write to CitizenFeedback', async () => {
    const sess = getNewSession();
    await chatService.sendMessage('hello', sess);
    await chatService.sendMessage('english', sess);
    await chatService.sendMessage('File Complaint', sess);
    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    await chatService.sendMessage(randomMobile, sess);
    await chatService.sendMessage('Rohit Sharma', sess);
    await chatService.sendMessage('Lucknow', sess);
    await chatService.sendMessage('Confirm', sess);
    await chatService.sendMessage('Sector 4, Gomti Nagar, Lucknow', sess);
    await chatService.sendMessage('option:Confirm Details', sess);

    // Enter workflow fields
    await chatService.sendMessage('Lost Mobile / Theft', sess);
    await chatService.sendMessage('Apple', sess);
    await chatService.sendMessage('iPhone 15', sess);
    await chatService.sendMessage('Black', sess);
    await chatService.sendMessage('2024', sess);
    await chatService.sendMessage('skip', sess);
    await chatService.sendMessage('Lucknow', sess);
    await chatService.sendMessage('10/06/2026', sess);
    await chatService.sendMessage('Phone fell near Hazratganj Lucknow', sess);
    
    // Submit
    const compSubmit = await chatService.sendMessage('option:Submit Application', sess);
    expect(compSubmit.response).toContain('Was this service helpful to you?');

    // Click rating 5
    const prevFeedbackCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    const feedRes = await chatService.sendMessage('5', sess);
    expect(feedRes.response).toContain('Thank you for your feedback');

    const newFeedbackCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    expect(newFeedbackCount - prevFeedbackCount).toBe(1);
  }, 30000);

  it('should process citizen_feedback database actions from AI Service', async () => {
    // Manually execute the DB Action to test the executeDbAction routing
    const sess = getNewSession();
    const prevFeedbackCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });

    const dbAction = {
      type: 'citizen_feedback',
      data: {
        sessionId: sess,
        citizenId: 'test-citizen-id',
        workflowType: 'complaint',
        rating: 5,
        comments: 'Excellent AI digital officer!'
      }
    };

    // Execute through chatService internal executeDbAction or public message route if mocked.
    // Call the internal executeDbAction directly using array wrapper or individual action.
    await (chatService as any).executeDbAction(dbAction);

    const newFeedbackCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    expect(newFeedbackCount - prevFeedbackCount).toBe(1);

    const feedbackRecord = await prisma.citizenFeedback.findFirst({
      where: { sessionId: sess }
    });
    expect(feedbackRecord?.rating).toBe(5);
    expect(feedbackRecord?.comments).toBe('Excellent AI digital officer!');
  }, 30000);
});
