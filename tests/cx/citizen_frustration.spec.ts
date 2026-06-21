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

describe('Citizen Frustration Test', () => {
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
    httpService.post = () => throwError(() => new Error('Forced connection failure for frustration testing')) as any;

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

  it('should handle citizen frustration gracefully and maintain state', async () => {
    const sess = "frust-sess-" + Math.random().toString(36).substring(7);

    // Initialize session to profile mobile collection
    await chatService.sendMessage("hello", sess);
    await chatService.sendMessage("english", sess);
    const mobilePrompt = await chatService.sendMessage("File Complaint", sess);
    expect(mobilePrompt.response).toContain("please enter your mobile number");

    // 1. Test "why do you need" frustration trigger during mobile collection
    const rWhy = await chatService.sendMessage("why do you need my mobile number?", sess);
    expect(rWhy.response).toContain("As a digital assistant, I require this information to comply with official UP Police records");
    expect(rWhy.response).toContain("please enter your mobile number");

    // Send mobile to advance (step becomes IDENTIFY_NAME)
    const namePrompt = await chatService.sendMessage("9898989898", sess);
    expect(namePrompt.response).toContain("Before we begin, may I know your name");

    // 2. Test "I don't know" during name collection
    const rDontKnow = await chatService.sendMessage("i don't know", sess);
    expect(rDontKnow.response).toContain("That is no problem. If you do not have this information");
    expect(rDontKnow.response).toContain("Before we begin, may I know your name");

    // Send name to advance
    await chatService.sendMessage("Ram Charan", sess);

    // 3. Test "I already told you" during location collection
    const rAlreadyTold = await chatService.sendMessage("i already told you my address is Noida", sess);
    expect(rAlreadyTold.response).toContain("Thank you for your patience. I have preserved the details");
    expect(rAlreadyTold.response).toContain("city, district, or area");

    // 4. Test "explain this" during location confirmation
    await chatService.sendMessage("Noida", sess);
    const rExplain = await chatService.sendMessage("explain what this is", sess);
    expect(rExplain.response).toContain("I am here to assist you. This is an official digital helpdesk");
    expect(rExplain.response).toMatch(/set your location as|complete address/);
  });
});
