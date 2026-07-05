require('dotenv').config({path: '../.env'});
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.emergencyAlertEvent.findMany({take: 10, orderBy: {createdAt: 'desc'}}).then(r => console.log(JSON.stringify(r, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
