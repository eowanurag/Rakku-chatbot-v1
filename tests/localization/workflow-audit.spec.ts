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

describe('Workflow Translation Leakage & Audit Test Suite', () => {
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
    // Force local fallback engine
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

  const getNewSession = () => 'audit-test-' + Math.random().toString(36).substring(7);

  it('should prevent English leakage in Hindi complaint workflows and assert proper translations', async () => {
    const sess = getNewSession();
    await chatService.sendMessage('hello', sess);
    await chatService.sendMessage('हिंदी', sess);
    
    // Select File Complaint
    const compRes = await chatService.sendMessage('File Complaint', sess);
    expect(compRes.response).toContain('मोबाइल नंबर'); // Hindi mobile prompt

    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    const nameRes = await chatService.sendMessage(randomMobile, sess);
    expect(nameRes.response).toContain('नाम जान सकता हूँ'); // Hindi name prompt

    await chatService.sendMessage('मनोज तिवारी', sess);
    
    const locRes = await chatService.sendMessage('Lucknow', sess);
    expect(locRes.response).toContain('लखनऊ');
    expect(locRes.response).toContain('पुष्टि करें');
    
    await chatService.sendMessage('Confirm', sess);
    const addressRes = await chatService.sendMessage('हजरतगंज, लखनऊ', sess);
    
    // Profile review screen must be localized and have zero English
    expect(addressRes.response).toContain('अपने विवरण की समीक्षा करें');
    expect(addressRes.response).not.toContain('Please review your details');
  });

  it('should prevent Hindi leakage in English complaint workflows and assert proper translations', async () => {
    const sess = getNewSession();
    await chatService.sendMessage('hello', sess);
    await chatService.sendMessage('english', sess);
    
    const compRes = await chatService.sendMessage('File Complaint', sess);
    expect(compRes.response).toContain('mobile number'); // English mobile prompt

    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    const nameRes = await chatService.sendMessage(randomMobile, sess);
    expect(nameRes.response).toContain('know your name'); // English name prompt

    await chatService.sendMessage('Manoj Tiwari', sess);
    
    const locRes = await chatService.sendMessage('Lucknow', sess);
    expect(locRes.response).toContain('Lucknow');
    expect(locRes.response).toContain('Confirm');
    
    await chatService.sendMessage('Confirm', sess);
    const addressRes = await chatService.sendMessage('Hazratganj, Lucknow', sess);
    
    // Profile review screen must be in English with zero Hindi
    expect(addressRes.response).toContain('Please review your details');
    expect(addressRes.response).not.toContain('अपने विवरण की समीक्षा करें');
  });
});
