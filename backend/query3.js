require('dotenv').config({path: '../.env'});
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.emergencyAlertEvent.findMany({where: {eventType: 'NOTIFICATION_FAILED'}, take: 5, orderBy: {createdAt: 'desc'}}).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
