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

describe('Returning Citizen Profile Lookup Test Suite', () => {
  let chatService: ChatService;
  let prisma: PrismaService;

  beforeAll(async () => {
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

    // Pre-populate a test citizen in the database
    await prisma.citizen.upsert({
      where: { id: 'returning-test-citizen-id' },
      update: {},
      create: {
        id: 'returning-test-citizen-id',
        fullName: 'Manoj Bajpai',
        mobileNumber: '9876543210',
        city: 'Lucknow',
        district: 'Lucknow',
        addressLine1: 'Sector 7, Gomti Nagar Extension, Lucknow',
        state: 'Uttar Pradesh',
        pincode: '226010',
        isConfirmed: true,
      },
    });
  });

  afterAll(async () => {
    // Cleanup test data using cascaded deletes
    const testCitizenIds = (await prisma.citizen.findMany({
      where: { mobileNumber: { in: ['9876543210', '9998887776', '9999999999'] } }
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

  it('Scenario 1: Existing citizen profile found and displays details', async () => {
    const sess = `ret-sess-1-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    const prompt = await chatService.sendMessage("9876543210", sess);
    
    expect(prompt.response).toContain("Welcome back, Manoj Bajpai");
    expect(prompt.response).toContain("Sector 7, Gomti Nagar Extension");
    expect(prompt.suggestions).toContain("Continue");
    expect(prompt.suggestions).toContain("Update Profile");
    expect(prompt.suggestions).toContain("Use Different Details");

    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("VERIFY_EXISTING_PROFILE");
    expect(state.citizen.fullName).toBe("Manoj Bajpai");
  });

  it('Scenario 2: Existing citizen continues directly', async () => {
    const sess = `ret-sess-2-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("9876543210", sess);
    await chatService.sendMessage("Continue", sess);
    const nextPrompt = await chatService.sendMessage("Lost Mobile / Theft", sess);

    // Verify that it skipped collecting name/address and went directly to complaint workflow brand step
    expect(nextPrompt.response).toContain("lost your mobile phone");
    expect(nextPrompt.suggestions).toContain("Apple");

    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.isConfirmed).toBe(true);
    expect(state.step).toBe("2_brand"); // Complaint workflow brand step
  });

  it('Scenario 3: Existing citizen chooses to update profile', async () => {
    const sess = `ret-sess-3-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("9876543210", sess);
    const updatePrompt = await chatService.sendMessage("Update Profile", sess);

    expect(updatePrompt.response).toContain("Which detail would you like to modify?");
    expect(updatePrompt.suggestions).toContain("1");
    expect(updatePrompt.suggestions).toContain("2");

    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("MODIFY_PROFILE_SELECT");
  });

  it('Scenario 4: Existing citizen chooses to use different details', async () => {
    const sess = `ret-sess-4-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("9876543210", sess);
    const diffPrompt = await chatService.sendMessage("Use Different Details", sess);

    // Should prompt for full name
    expect(diffPrompt.response).toContain("may I know your name");

    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("IDENTIFY_NAME");
    expect(state.citizen.fullName).toBeUndefined(); // cleared name
    expect(state.citizen.mobileNumber).toBe("9876543210"); // kept mobile
  });

  it('Scenario 5: Mobile number not found in database', async () => {
    const sess = `ret-sess-5-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    const prompt = await chatService.sendMessage("9999999999", sess);

    expect(prompt.response).toContain("I couldn't find an existing profile");
    expect(prompt.response).toContain("may I know your name");

    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("IDENTIFY_NAME");
    expect(state.citizen.mobileNumber).toBe("9999999999");
  });

  it('Scenario 6: New citizen registration flow from scratch', async () => {
    const sess = `ret-sess-6-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    
    // First prompt asks for mobile first
    const p1 = await chatService.getOrCreateSession(sess);
    expect(p1.step).toBe("IDENTIFY_MOBILE_FIRST");

    await chatService.sendMessage("9998887776", sess); // enters mobile
    await chatService.sendMessage("Sunil Dutt", sess); // enters name
    await chatService.sendMessage("Meerut", sess); // enters city
    await chatService.sendMessage("Confirm", sess); // confirms city
    const pReview = await chatService.sendMessage("Cantt Area, Meerut - 250001", sess); // enters address

    expect(pReview.response).toContain("Please review your details");
    expect(pReview.response).toContain("Sunil Dutt");
    expect(pReview.response).toContain("9998887776");

    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("CONFIRM_PROFILE");
  });

  it('Scenario 7: Localization coverage (Hindi welcome back)', async () => {
    const sess = `ret-sess-7-${Date.now()}`;
    await chatService.sendMessage("hello", sess);
    await chatService.sendMessage("हिंदी", sess); // select language
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("9876543210", sess);
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("VERIFY_EXISTING_PROFILE");
    expect(state.language).toBe("hi");
  });

  it('Scenario 8: Session recovery works with new steps', async () => {
    const sess = `ret-sess-8-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("9876543210", sess);

    const recovered = await chatService.getOrCreateSession(sess);
    expect(recovered.step).toBe("VERIFY_EXISTING_PROFILE");
    expect(recovered.citizen.fullName).toBe("Manoj Bajpai");
  });
});
