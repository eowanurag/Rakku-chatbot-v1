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

describe('Stability and Resilience Regression Suite', () => {
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
    httpService.post = () => throwError(() => new Error('Forced connection failure for stability testing')) as any;

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

  it('should include _debug field in responses', async () => {
    const sess = "stability-sess-1-" + Math.random().toString(36).substring(7);
    const helloRes = await chatService.sendMessage("hello", sess);
    expect(helloRes._debug).toBeDefined();
    expect(helloRes._debug?.activeEngine).toBe('FALLBACK');
  });

  it('should write trace logs to AuditLog DB table', async () => {
    const sess = "stability-sess-2-" + Math.random().toString(36).substring(7);
    await chatService.sendMessage("hello", sess);
    const latestLog = await prisma.auditLog.findFirst({
      where: { sessionId: sess },
      orderBy: { createdAt: 'desc' },
    });
    expect(latestLog).not.toBeNull();
    if (latestLog) {
      const data = latestLog.eventData as any;
      expect(data.engine).toBe('FALLBACK');
    }
  });

  it('should handle action button payloads properly', async () => {
    const sess = "stability-sess-3-" + Math.random().toString(36).substring(7);
    await chatService.sendMessage("hello", sess);
    await chatService.sendMessage("english", sess);
    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    await chatService.sendMessage(randomMobile, sess);
    await chatService.sendMessage("Rahul Roy", sess);
    await chatService.sendMessage("Kanpur", sess);
    await chatService.sendMessage("Confirm", sess); // Confirm location
    const confirmationPrompt = await chatService.sendMessage("Sector 1, Kanpur - 208002", sess);
    expect(confirmationPrompt.response).toContain("Please review your details");

    const confirmRes = await chatService.sendMessage("option:Confirm Details", sess);
    expect(confirmRes.response).toContain("Citizen Profile Verified");
  });

  it('should normalize tracking reference numbers seamlessly', async () => {
    const trackSess = "track-norm-sess-" + Math.random().toString(36).substring(7);
    await chatService.sendMessage("hello", trackSess);
    await chatService.sendMessage("english", trackSess);
    await chatService.sendMessage("Track status", trackSess);
    
    // Spaces, tabs, and mixed casing in reference number
    const normalTrackRes = await chatService.sendMessage("  up-cmp   2026  123456  ", trackSess);
    expect(normalTrackRes.response).toContain("No application found");
  });

  it('should detect dead-end states and reset gracefully', async () => {
    const originalRunComplaintWorkflow = (chatService as any).runComplaintWorkflow;
    (chatService as any).runComplaintWorkflow = async () => {
      return { response: 'Invalid step' };
    };

    const deadEndSess = "dead-end-sess-" + Math.random().toString(36).substring(7);
    await chatService.sendMessage("hello", deadEndSess);
    await chatService.sendMessage("english", deadEndSess);
    await chatService.sendMessage("File Complaint", deadEndSess);
    const randomMobile = '9' + Math.floor(100000000 + Math.random() * 900000000).toString();
    await chatService.sendMessage(randomMobile, deadEndSess);
    await chatService.sendMessage("Test User", deadEndSess);
    await chatService.sendMessage("Lucknow", deadEndSess);
    await chatService.sendMessage("Confirm", deadEndSess); // Confirm location
    await chatService.sendMessage("Gomti Nagar, Lucknow - 226010", deadEndSess);
    await chatService.sendMessage("option:Confirm Details", deadEndSess); // triggers mock return 'Invalid step'

    const deadEndResponse = await chatService.sendMessage("Some message", deadEndSess);
    expect(deadEndResponse.response).toContain("encountered an issue processing your request");
    
    const restoredSession = await chatService.getOrCreateSession(deadEndSess);
    expect(restoredSession.step).toBe('START');

    // Restore original method
    (chatService as any).runComplaintWorkflow = originalRunComplaintWorkflow;
  });
});
