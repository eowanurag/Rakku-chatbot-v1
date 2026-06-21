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

describe('Full Localization & Translation Leakage Test Suite', () => {
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

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const getNewSession = () => 'localization-test-' + Math.random().toString(36).substring(7);

  it('should render Hindi translation keys in Profile Confirmation and prevent English leakage', async () => {
    const sess = getNewSession();
    await chatService.sendMessage('hello', sess);
    
    // Select Hindi language
    const langSelect = await chatService.sendMessage('हिंदी', sess);
    expect(langSelect.response).toContain('सहायता'); // Hindi welcome message

    await chatService.sendMessage('File Complaint', sess);
    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    await chatService.sendMessage(randomMobile, sess);
    await chatService.sendMessage('रोहित शर्मा', sess);
    
    // Test localized location confirmation
    const locRes = await chatService.sendMessage('Lucknow', sess);
    // Should say: "मुझे आपका स्थान लखनऊ, उत्तर प्रदेश मिला है। क्या यह सही है?"
    expect(locRes.response).toContain('मुझे आपका स्थान');
    expect(locRes.response).toContain('लखनऊ');
    expect(locRes.response).toContain('उत्तर प्रदेश');

    await chatService.sendMessage('Confirm', sess);
    
    // Provide address, transitions to Profile Review
    const reviewRes = await chatService.sendMessage('मकान नंबर 24, सिविल लाइंस, लखनऊ', sess);
    expect(reviewRes.response).toContain('कृपया अपने विवरण की समीक्षा करें');
    expect(reviewRes.response).toContain('नाम');
    expect(reviewRes.response).toContain('मोबाइल नंबर');
    expect(reviewRes.response).toContain('स्थान');
    expect(reviewRes.response).toContain('पता');
    expect(reviewRes.response).not.toContain('Please review your details');
  });

  it('should translate checklist items on the fallback active review screens in Hindi mode', async () => {
    const sess = getNewSession();
    await chatService.sendMessage('hello', sess);
    await chatService.sendMessage('हिंदी', sess);
    await chatService.sendMessage('File Complaint', sess);
    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    await chatService.sendMessage(randomMobile, sess);
    await chatService.sendMessage('रोहित शर्मा', sess);
    await chatService.sendMessage('Lucknow', sess);
    await chatService.sendMessage('Confirm', sess);
    await chatService.sendMessage('मकान नंबर 24, सिविल लाइंस, लखनऊ', sess);
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
    
    // Provide description, transitions to Pre-Submission Review screen
    const finalReview = await chatService.sendMessage('Hazratganj market near park', sess);
    
    // Checklist validations check (✓ / ✗ validation indicators)
    expect(finalReview.response).toContain('आवेदक की जानकारी पूर्ण');
    expect(finalReview.response).toContain('सम्पर्क विवरण मान्य');
    expect(finalReview.response).toContain('स्थान की पुष्टि की गई');
  });
});
