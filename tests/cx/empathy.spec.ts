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

describe('Empathy Prepend Test Suite', () => {
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

  const getNewSession = () => 'empathy-test-' + Math.random().toString(36).substring(7);

  it('should prepended empathy message for mobile theft in English', async () => {
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

    // Now in workflow. Step 2 asks for type.
    const res = await chatService.sendMessage('My mobile phone was stolen', sess);
    expect(res.response).toContain("I'm sorry to hear that your phone was stolen");
  });

  it('should prepended empathy message for mobile theft in Hindi', async () => {
    const sess = getNewSession();
    await chatService.sendMessage('hello', sess);
    await chatService.sendMessage('हिंदी', sess); // Hindi mode
    await chatService.sendMessage('File Complaint', sess);
    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    await chatService.sendMessage(randomMobile, sess);
    await chatService.sendMessage('Rohit Sharma', sess);
    await chatService.sendMessage('Lucknow', sess);
    await chatService.sendMessage('Confirm', sess);
    await chatService.sendMessage('Sector 4, Gomti Nagar, Lucknow', sess);
    await chatService.sendMessage('option:Confirm Details', sess);

    const res = await chatService.sendMessage('मेरा मोबाइल चोरी हो गया', sess);
    expect(res.response).toContain('मुझे यह सुनकर दुख हुआ कि आपका मोबाइल चोरी हो गया है');
  });
});
