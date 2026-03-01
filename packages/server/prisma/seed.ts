import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedBootstrapData } from '../src/bootstrap/database-seed.js';

const prisma = new PrismaClient();

async function seed() {
  await seedBootstrapData(prisma, {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
  });
  console.log('Seed completed!');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
