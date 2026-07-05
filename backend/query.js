const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.emergencyAlert.count();
  const latest = await prisma.emergencyAlert.findMany({
    take: 2,
    orderBy: { createdAt: 'desc' }
  });
  console.log('Total Alerts:', count);
  console.log('Latest Alerts:', JSON.stringify(latest, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
