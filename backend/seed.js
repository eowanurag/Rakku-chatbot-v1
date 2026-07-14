require('dotenv').config({ path: '../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed (keeping existing data)...');
  
  // 1. Citizen
  let citizen = await prisma.citizen.findFirst({ where: { mobileNumber: "9999999999" } });
  if (!citizen) {
    citizen = await prisma.citizen.create({
      data: {
        fullName: "Demo Citizen",
        mobileNumber: "9999999999",
        isConfirmed: true,
      }
    });
    console.log('Created citizen');
  }

  // 2. Complaints
  const complaints = [
    { type: 'Theft', details: 'Mobile phone snatched near Hazratganj crossing', status: 'Submitted' },
    { type: 'Cyber Fraud', details: 'Lost 10000 Rs in OLX scam', status: 'Under Review' },
    { type: 'Harassment', details: 'Continuous harassing calls from unknown number', status: 'Approved' },
  ];
  for (let i = 0; i < complaints.length; i++) {
    await prisma.complaint.create({
      data: {
        referenceNumber: `UP-CMP-2026-${Math.floor(100000 + Math.random() * 900000)}`,
        citizenId: citizen.id,
        complaintType: complaints[i].type,
        incidentDetails: complaints[i].details,
        status: complaints[i].status
      }
    });
  }
  console.log('Created complaints');

  // 3. Verifications
  const verifs = [
    { type: 'Tenant Verification', name: 'Ravi Kumar', address: 'Gomti Nagar, Lucknow', property: 'House 42', status: 'Pending Verification' },
    { type: 'Employee Verification', name: 'Sunil Singh', address: 'Indira Nagar', property: 'Shop 12', status: 'Approved' }
  ];
  for (let i = 0; i < verifs.length; i++) {
    await prisma.verification.create({
      data: {
        referenceNumber: `UP-VER-2026-${Math.floor(100000 + Math.random() * 900000)}`,
        citizenId: citizen.id,
        verificationType: verifs[i].type,
        name: verifs[i].name,
        address: verifs[i].address,
        mobile: '9876543210',
        propertyDetails: verifs[i].property,
        status: verifs[i].status
      }
    });
  }
  console.log('Created verifications');

  // 4. Certificates
  await prisma.characterCertificate.create({
    data: {
      referenceNumber: `UP-CER-2026-${Math.floor(100000 + Math.random() * 900000)}`,
      citizenId: citizen.id,
      name: 'Demo Citizen',
      address: 'Lucknow',
      district: 'LUCKNOW',
      purpose: 'Private Job',
      status: 'Approved'
    }
  });
  console.log('Created certificates');

  // 5. Events
  await prisma.eventPermission.create({
    data: {
      referenceNumber: `UP-EVT-2026-${Math.floor(100000 + Math.random() * 900000)}`,
      citizenId: citizen.id,
      eventType: 'Religious Procession',
      eventName: 'Navratri Puja',
      location: 'Aminabad',
      date: '2026-10-10',
      expectedAttendance: 500,
      status: 'Submitted'
    }
  });
  console.log('Created events');

  // 7. Intelligence Data
  const langs = ['en', 'en', 'hi', 'hi', 'hi', 'hinglish']; // Weighted towards Hindi
  console.log('Seeding conversation insights...');
  const insightData = [];
  for (let i = 0; i < 200; i++) {
    insightData.push({
      sessionId: `sess_${Date.now()}_${i}`,
      detectedIntent: 'complaint_filing',
      confidenceScore: 0.9,
      language: langs[Math.floor(Math.random() * langs.length)],
      resolved: true
    });
  }
  await prisma.conversationInsight.createMany({ data: insightData });

  console.log('Seeding sentiment...');
  const emotions = ['Satisfied', 'Satisfied', 'Happy', 'Frustrated', 'Confused', 'Neutral', 'Neutral', 'Angry'];
  const sentimentData = [];
  for (let i = 0; i < 250; i++) {
    sentimentData.push({
      sessionId: `sess_sent_${Date.now()}_${i}`,
      sentiment: 'neutral',
      emotion: emotions[Math.floor(Math.random() * emotions.length)]
    });
  }
  await prisma.conversationSentiment.createMany({ data: sentimentData });

  console.log('Seeding workflow analytics...');
  const workflowData = [];
  for (let i = 0; i < 300; i++) {
    const completed = Math.random() > 0.12; // 88% completion
    workflowData.push({
      workflowType: 'Complaint',
      stepName: 'Final',
      completed: completed,
      abandoned: !completed
    });
  }
  await prisma.workflowAnalytics.createMany({ data: workflowData });

  console.log('Seeding feedback...');
  const feedbackData = [];
  for (let i = 0; i < 50; i++) {
    feedbackData.push({
      sessionId: `sess_fb_${Date.now()}_${i}`,
      rating: Math.floor(Math.random() * 2) + 4, // 4 or 5 (Avg ~4.5)
    });
  }
  await prisma.citizenFeedback.createMany({ data: feedbackData });

  console.log('Seeding unanswered...');
  const existingUnanswered = await prisma.unansweredQuestion.findFirst({ where: { question: "लाउडस्पीकर की अनुमति कैसे लें?" } });
  if (!existingUnanswered) {
    await prisma.unansweredQuestion.create({
      data: { question: "What is the process for drone flying permission?", language: "en", frequency: 45 }
    });
    await prisma.unansweredQuestion.create({
      data: { question: "लाउडस्पीकर की अनुमति कैसे लें?", language: "hi", frequency: 89 }
    });
  }
  
  console.log('Seeding complete! Old data was untouched, new sample data has been injected.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
