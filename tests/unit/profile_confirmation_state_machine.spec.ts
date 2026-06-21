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

describe('Profile Confirmation & Citizen Identification State Machine Test', () => {
  let chatService: ChatService;
  let prisma: PrismaService;
  let validation: ValidationService;

  beforeAll(() => {
    prisma = new PrismaService();
    const config = new ConfigService();
    validation = new ValidationService();
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

  it('Test Scenario 1: Happy Path', async () => {
    const sess = `test-sess-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    const wfRes = await chatService.sendMessage("Confirm Details", sess);
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.isConfirmed).toBe(true);
    expect(state.step).toBe("2"); // Transitions directly into the workflow step
  });

  it('Test Scenario 2: Address Corruption Protection', async () => {
    const sess = `test-sess-corruption-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    
    // In CONFIRM_LOCATION
    await chatService.sendMessage("Confirm", sess);
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.addressLine1).not.toBe("Confirm");
    expect(state.citizen.addressLine1).not.toBe("Yes");
    expect(state.citizen.addressLine1).not.toBe("No");
  });

  it('Test Scenario 3: Address Mandatory', async () => {
    const sess = `test-sess-mandatory-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess); // Confirm location -> IDENTIFY_ADDRESS
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).not.toBe("CONFIRM_PROFILE");
    expect(state.step).toBe("IDENTIFY_ADDRESS");
  });

  it('Test Scenario 4: Profile Confirmation Transition', async () => {
    const sess = `test-sess-trans-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    
    await chatService.sendMessage("Confirm Details", sess);
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.isConfirmed).toBe(true);
    // After profile confirmation, it starts the workflow and reaches step 2
    expect(state.step).toBe("2");
  });

  it('Test Scenario 5: Confirmation Loop Detection', async () => {
    const sess = `test-sess-loop-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    
    const res1 = await chatService.sendMessage("Confirm Details", sess);
    const state1 = await chatService.getOrCreateSession(sess);
    expect(state1.citizen.isConfirmed).toBe(true);
    expect(state1.step).toBe("2");
    
    // Send it again to verify it doesn't loop
    const res2 = await chatService.sendMessage("Confirm Details", sess);
    expect(res2.response).not.toContain("Citizen Profile Verified"); // Should not show profile confirmation success again
    
    const state2 = await chatService.getOrCreateSession(sess);
    expect(state2.step).not.toBe("CONFIRM_PROFILE"); // Proves no loop
  });

  it('Test Scenario 6: Change Location', async () => {
    const sess = `test-sess-change-loc-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess); // Moves to IDENTIFY_LOCATION
    await chatService.sendMessage("Ayodhya", sess); // Moves to CONFIRM_LOCATION
    
    const res = await chatService.sendMessage("Change Location", sess);
    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("IDENTIFY_LOCATION");
  });

  it('Test Scenario 7: Modify Mobile', async () => {
    const sess = `test-sess-modify-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    
    await chatService.sendMessage("Modify Details", sess);
    const state = await chatService.getOrCreateSession(sess);
    expect(state.step).toBe("MODIFY_PROFILE_SELECT");
    expect(state.citizen.fullName).toBeDefined();
    expect(state.citizen.city).toBeDefined();
    expect(state.citizen.addressLine1).toBeDefined();
  });

  it('Test Scenario 8: Reserved Command Protection', async () => {
    const reserved = ['yes', 'no', 'confirm', 'change', 'modify', 'submit', 'ok'];
    for (const cmd of reserved) {
      const data = validation.extractCitizenData(cmd);
      expect(data.name).toBeUndefined();
      expect(data.location).toBeUndefined();
    }
  });

  it('Test Scenario 9: Internal Action Leakage', async () => {
    const sess = `test-sess-leak-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    const res = await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    
    expect(res.response).not.toContain("action:PROFILE_CONFIRM");
    expect(res.response).not.toContain("action:MODIFY_PROFILE");
    expect(res.response).not.toContain("action:SUBMIT_APPLICATION");
  });

  it('Test Scenario 10: Full Data Integrity', async () => {
    const sess = `test-sess-integrity-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    await chatService.sendMessage("Confirm Details", sess);
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.fullName).toBe("Manoj Tiwari");
    expect(state.citizen.mobileNumber).toBe("7878787878");
    expect(state.citizen.city).toContain("Ayodhya");
    expect(state.citizen.addressLine1).toContain("Civil Lines");
    expect(state.citizen.isConfirmed).toBe(true);
  });

  it('Test Scenario 11: Geolocation Smart Flow', async () => {
    const sess = `test-sess-smart-geo-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    
    // Inject browser geolocation coords
    const state = await chatService.getOrCreateSession(sess);
    state.citizen.latitude = 26.8467;
    state.citizen.longitude = 80.9462;
    await chatService.saveSession(sess, state);

    // Provide mobile number -> triggers auto-location
    const res = await chatService.sendMessage("7878787878", sess);
    expect(res._debug.step).toBe("CONFIRM_LOCATION_SMART");
    expect(res.response).toContain("Lucknow");

    // Confirm location
    const res2 = await chatService.sendMessage("Confirm", sess);
    expect(res2._debug.step).toBe("CONFIRM_ADDRESS_SMART");

    // Confirm address
    const res3 = await chatService.sendMessage("Confirm", sess);
    expect(res3._debug.step).toBe("CONFIRM_PROFILE");
  });

  it('Test Scenario 12: Single Field Modification Flow', async () => {
    const sess = `test-sess-smart-mod-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    
    // Modify Name
    await chatService.sendMessage("Modify Details", sess);
    await chatService.sendMessage("1", sess); // Select Name
    const res = await chatService.sendMessage("Mohan Singh", sess);
    expect(res.response).toContain("✅ Name updated successfully");
    expect(res._debug.step).toBe("CONFIRM_PROFILE");
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.fullName).toBe("Mohan Singh");
  });

  it('Test Scenario 13: GPS unavailable prompts manual location entry and no default is created', async () => {
    const sess = `test-sess-manual-fallback-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    
    // Send mobile. Geolocation coordinates are not injected, returning profile skipped, IP location missing.
    const res = await chatService.sendMessage("9898989898", sess);
    expect(res._debug.step).toBe("IDENTIFY_LOCATION");
    expect(res.response).toContain("Unable to determine your current location automatically");
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.city).toBe("");
    expect(state.citizen.addressLine1).toBe("");
  });

  it('Test Scenario 14: Cross-district location changes clear address', async () => {
    const sess = `test-sess-cross-district-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Ayodhya", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 22 Civil Lines Ayodhya", sess);
    
    // Modify Location to Meerut (which is a different district than Ayodhya)
    await chatService.sendMessage("Modify Details", sess);
    await chatService.sendMessage("3", sess); // Select Location
    const res = await chatService.sendMessage("Meerut", sess);
    
    expect(res.response).toContain("Location updated successfully");
    expect(res.response).toContain("previous address may no longer be valid");
    expect(res._debug.step).toBe("IDENTIFY_ADDRESS");
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.city).toBe("Meerut");
    expect(state.citizen.addressLine1).toBe("");
  });

  it('Test Scenario 15: Same-district location changes preserve address', async () => {
    const sess = `test-sess-same-district-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Lucknow", sess);
    await chatService.sendMessage("Confirm", sess);
    await chatService.sendMessage("House No 12 Hazratganj Lucknow", sess);
    
    // Modify Location to Gomti Nagar (which is also under Lucknow district)
    await chatService.sendMessage("Modify Details", sess);
    await chatService.sendMessage("3", sess);
    const res = await chatService.sendMessage("Gomti Nagar", sess);
    
    expect(res.response).toContain("✅ Location updated successfully");
    expect(res._debug.step).toBe("CONFIRM_PROFILE");
    
    const state = await chatService.getOrCreateSession(sess);
    expect(state.citizen.city).toBe("Gomti Nagar");
    expect(state.citizen.addressLine1).toBe("House No 12 Hazratganj Lucknow");
  });

  it('Test Scenario 16: Review screen protection clears mismatched location/address', async () => {
    const sess = `test-sess-mismatch-protect-${Date.now()}`;
    await chatService.sendMessage("File Complaint", sess);
    await chatService.sendMessage("Manoj Tiwari", sess);
    await chatService.sendMessage("7878787878", sess);
    await chatService.sendMessage("Meerut", sess);
    await chatService.sendMessage("Confirm", sess);
    
    // Inject mismatched address directly into state to simulate bypass or corrupt data
    const state = await chatService.getOrCreateSession(sess);
    state.citizen.addressLine1 = "Cantt, Ayodhya"; 
    await chatService.saveSession(sess, state);
    
    // Transition to CONFIRM_PROFILE
    const res = await chatService.sendMessage("Confirm", sess);
    expect(res.response).toContain("Your address does not match your selected location");
    expect(res._debug.step).toBe("IDENTIFY_ADDRESS");
    
    const updatedState = await chatService.getOrCreateSession(sess);
    expect(updatedState.citizen.addressLine1).toBe("");
  });
});
