import { ComplaintService } from '@backend/complaint/complaint.service';
import { PrismaService } from '@backend/prisma.service';

describe('Cross-Site Scripting (XSS) Mitigation Spec', () => {
  let complaintService: ComplaintService;
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    complaintService = new ComplaintService(prisma);

    // Clean up any existing fingerprints for our test payloads to avoid test leakage
    const fingerprintService = (complaintService as any).fingerprintService;
    if (fingerprintService) {
      const defaultCitizen = await prisma.citizen.findFirst();
      const citizenId = defaultCitizen ? defaultCitizen.id : 'mock-default-citizen-id';
      for (const payload of xssPayloads) {
        const fp = fingerprintService.generateFingerprint(citizenId, 'Complaint', { type: 'Cyber Crime', details: payload });
        await prisma.submissionFingerprint.deleteMany({ where: { fingerprint: fp } });
      }
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const xssPayloads = [
    "<script>alert('xss')</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "<svg/onload=alert(1)>"
  ];

  xssPayloads.forEach((payload, idx) => {
    it(`should safely store and handle XSS payload ${idx}: "${payload}" without corruption`, async () => {
      const res = await complaintService.createComplaint('Cyber Crime', payload);
      expect(res.referenceNumber).toBeDefined();

      const retrieved = await prisma.complaint.findUnique({
        where: { referenceNumber: res.referenceNumber }
      });
      expect(retrieved?.incidentDetails).toBe(payload);

      // Clean up complaint
      await prisma.complaint.delete({
        where: { referenceNumber: res.referenceNumber }
      });

      // Clean up fingerprint to avoid duplicate submission blocks on successive runs
      const fingerprintService = (complaintService as any).fingerprintService;
      if (fingerprintService) {
        const citizenId = retrieved?.citizenId || 'default-citizen-id';
        const fp = fingerprintService.generateFingerprint(citizenId, 'Complaint', { type: 'Cyber Crime', details: payload });
        await prisma.submissionFingerprint.deleteMany({ where: { fingerprint: fp } });
      }
    });
  });
});
