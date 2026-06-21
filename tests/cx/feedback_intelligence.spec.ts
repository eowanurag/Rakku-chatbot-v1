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

describe('Feedback Intelligence Test Suite', () => {
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

  const getNewSession = () => 'feedback-intel-test-' + Math.random().toString(36).substring(7);

  const completeWorkflow = async (sess: string) => {
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

    await chatService.sendMessage('Lost Mobile / Theft', sess);
    await chatService.sendMessage('Apple', sess);
    await chatService.sendMessage('iPhone 15', sess);
    await chatService.sendMessage('Black', sess);
    await chatService.sendMessage('2024', sess);
    await chatService.sendMessage('skip', sess);
    await chatService.sendMessage('Lucknow', sess);
    await chatService.sendMessage('10/06/2026', sess);
    await chatService.sendMessage('Phone fell near Hazratganj Lucknow', sess);
    
    return await chatService.sendMessage('option:Submit Application', sess);
  };

  it('should allow neutral rating (3) to skip comment', async () => {
    const sess = getNewSession();
    await completeWorkflow(sess);

    // Send neutral rating
    const commentAsk = await chatService.sendMessage('3', sess);
    expect(commentAsk.suggestions).toContain('Skip');

    // Send skip
    const prevCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    const finalRes = await chatService.sendMessage('Skip', sess);
    expect(finalRes.response).toContain('Thank you for your feedback');

    const newCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    expect(newCount - prevCount).toBe(1);

    const record = await prisma.citizenFeedback.findFirst({
      where: { sessionId: sess }
    });
    expect(record?.rating).toBe(3);
    expect(record?.comments).toBe('');
    expect(record?.category).toBe('OTHER');
  }, 30000);

  it('should require a comment for rating <= 2 and reject skip command', async () => {
    const sess = getNewSession();
    await completeWorkflow(sess);

    // Send negative rating (2)
    const commentAsk = await chatService.sendMessage('2', sess);
    // Comment should be required, suggestions list should not contain Skip
    expect(commentAsk.suggestions || []).not.toContain('Skip');

    // Try to skip
    const rejectRes = await chatService.sendMessage('Skip', sess);
    expect(rejectRes.response).toContain('Comments are required');

    // Now send actual comment indicating localization issue
    const prevCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    const finalRes = await chatService.sendMessage('हिन्दी मे बात करों', sess);
    expect(finalRes.response).toContain('Thank you for your feedback');

    const newCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    expect(newCount - prevCount).toBe(1);

    const record = await prisma.citizenFeedback.findFirst({
      where: { sessionId: sess }
    });
    expect(record?.rating).toBe(2);
    expect(record?.comments).toBe('हिन्दी मे बात करों');
    expect(record?.category).toBe('LOCALIZATION');
  }, 30000);

  it('should categorize other comments appropriately (e.g. location error)', async () => {
    const sess = getNewSession();
    await completeWorkflow(sess);

    // Send negative rating (1)
    await chatService.sendMessage('1', sess);

    // Send comment about location
    const prevCount = await prisma.citizenFeedback.count({ where: { sessionId: sess } });
    const finalRes = await chatService.sendMessage('the location detection has a zila/district error', sess);
    expect(finalRes.response).toContain('Thank you for your feedback');

    const record = await prisma.citizenFeedback.findFirst({
      where: { sessionId: sess }
    });
    expect(record?.rating).toBe(1);
    expect(record?.category).toBe('LOCATION_ERROR');
  }, 30000);
});
