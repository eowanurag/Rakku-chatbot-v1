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

describe('Profile Reuse Protocol (PRP) Test Suite', () => {
  jest.setTimeout(30000);
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
    const testMobiles = ['8989898989', '9988776655'];
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
    const testMobiles = ['8989898989', '9988776655'];
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
    await prisma.$disconnect();
  });

  const getNewSession = () => 'prp-test-' + Math.random().toString(36).substring(7);

  const verifyProfile = async (sess: string, name: string = 'Juhi Pandey', mobile?: string) => {
    const mob = mobile || '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    await chatService.sendMessage('hello', sess);
    await chatService.sendMessage('english', sess);
    await chatService.sendMessage('📜 Character Certificate', sess);
    await chatService.sendMessage(mob, sess);
    await chatService.sendMessage(name, sess);
    await chatService.sendMessage('Ayodhya', sess);
    await chatService.sendMessage('Confirm', sess);
    await chatService.sendMessage('Cant, Ayodhya', sess);
    const verifiedRes = await chatService.sendMessage('option:Confirm Details', sess);
    return verifiedRes;
  };

  it('should support Character Certificate (Myself)', async () => {
    const sess = getNewSession();
    const verified = await verifyProfile(sess);

    // PRP Screen presented
    expect(verified.response).toContain('I found a verified profile');
    expect(verified.suggestions).toContain('Use My Verified Details');
    expect(verified.suggestions).toContain('Apply For Someone Else');

    // Select "Use My Verified Details"
    const confirmRes = await chatService.sendMessage('option:Use My Verified Details', sess);
    expect(confirmRes.response).toContain('I will use your verified details');
    expect(confirmRes.suggestions).toContain('Continue');

    // Select "Continue" -> Jump directly to Purpose (Step 5)
    const purposePrompt = await chatService.sendMessage('option:Continue', sess);
    expect(purposePrompt.response).toContain('purpose of this certificate');

    // Provide Purpose -> Review Screen
    const reviewRes = await chatService.sendMessage('Job Application', sess);
    expect(reviewRes.response).toContain('Subject Information Source:');
    expect(reviewRes.response).toContain('Cant, Ayodhya');

    // Verify Isolation
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.fullName).toBe('Juhi Pandey');
  });

  it('should support Character Certificate (Someone Else)', async () => {
    const sess = getNewSession();
    await verifyProfile(sess);

    // Select "Apply For Someone Else" -> Prompts for manual name entry
    const namePrompt = await chatService.sendMessage('option:Apply For Someone Else', sess);
    expect(namePrompt.response).toContain("What is your full name?");

    // Input Subject Details
    await chatService.sendMessage('Rahul Pandey', sess);
    await chatService.sendMessage('Varanasi City', sess);
    await chatService.sendMessage('Varanasi', sess);
    
    // Select Purpose
    const reviewRes = await chatService.sendMessage('Passport', sess);
    expect(reviewRes.response).toContain('Subject Information Source:');
    expect(reviewRes.response).toContain('✓ Provided Manually');
    expect(reviewRes.response).toContain('Subject Name: **Rahul Pandey**');

    // Isolation check: Applicant profile remains Juhi Pandey
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.fullName).toBe('Juhi Pandey');
  });

  it('should support Event Permission (Myself)', async () => {
    const sess = getNewSession();
    await verifyProfile(sess, 'Juhi Pandey', '8989898989');

    // Switch to Event Permission workflow
    await chatService.sendMessage('cancel', sess);
    const prpInit = await chatService.sendMessage('🎭 Event Permission', sess);

    // Prompt request type
    await chatService.sendMessage('Event Permission', sess);

    // PRP Screen presented for Organizer details
    const choiceRes = await chatService.sendMessage('option:Use My Verified Details', sess);
    expect(choiceRes.response).toContain('I will use your verified details');

    // Continue -> Prompt for Event Name (Step 3)
    const eventNameRes = await chatService.sendMessage('option:Continue', sess);
    expect(eventNameRes.response).toContain('name of your event');

    // Continue event details
    await chatService.sendMessage('Ayodhya Festival', sess);
    await chatService.sendMessage('Ayodhya Grounds', sess);
    await chatService.sendMessage('15/08/2026', sess);
    const reviewRes = await chatService.sendMessage('500', sess);

    expect(reviewRes.response).toContain('Organizer Information Source:');
    expect(reviewRes.response).toContain('✓ Reused From Verified Profile');
    expect(reviewRes.response).toContain('Organizer Name: **Juhi Pandey**');
    expect(reviewRes.response).toContain('Organizer Mobile: **8989898989**');
  });

  it('should support Event Permission (Someone Else)', async () => {
    const sess = getNewSession();
    await verifyProfile(sess);

    // Switch to Event Permission
    await chatService.sendMessage('cancel', sess);
    await chatService.sendMessage('🎭 Event Permission', sess);
    await chatService.sendMessage('Event Permission', sess);

    // Select "Apply For Someone Else" -> Prompts for Organizer Name
    const namePrompt = await chatService.sendMessage('option:Apply For Someone Else', sess);
    expect(namePrompt.response).toContain("Organizer's Full Name");

    // Input manual organizer details
    await chatService.sendMessage('Gaurav Singh', sess);
    await chatService.sendMessage('Gomti Nagar, Lucknow', sess);
    await chatService.sendMessage('9988776655', sess);

    // Input Event details
    await chatService.sendMessage('Noida Expo', sess);
    await chatService.sendMessage('Expo Mart', sess);
    await chatService.sendMessage('20/12/2026', sess);
    const reviewRes = await chatService.sendMessage('1000', sess);

    expect(reviewRes.response).toContain('Organizer Information Source:');
    expect(reviewRes.response).toContain('✓ Provided Manually');
    expect(reviewRes.response).toContain('Organizer Name: **Gaurav Singh**');
    expect(reviewRes.response).toContain('Organizer Mobile: **9988776655**');
  });

  it('should leave Tenant Verification workflow unaffected by PRP', async () => {
    const sess = getNewSession();
    await verifyProfile(sess);

    // Switch to Tenant Verification
    await chatService.sendMessage('cancel', sess);
    const tvInit = await chatService.sendMessage('🏠 Tenant Verification', sess);

    // Should NOT show PRP choice, should ask for Verification Type
    expect(tvInit.response).not.toContain('I found a verified profile');
    expect(tvInit.response).toContain('select the **Verification Type**');

    const tvPrompt = await chatService.sendMessage('Tenant Verification', sess);
    expect(tvPrompt.response).not.toContain('I found a verified profile');
    expect(tvPrompt.response).toContain('What is their full name?');
  });
});
