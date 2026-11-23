import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedJcOrganizations, type JcSeedData } from '../modules/jc-org/seed.js';

const db = new PrismaClient();
try {
  const path = resolve(process.cwd(), 'prisma/data/jc-organizations.json');
  const data: JcSeedData = JSON.parse(await readFile(path, 'utf-8'));
  const dryRun = process.argv.includes('--dry-run');
  const counts = await seedJcOrganizations(db, data, { dryRun });
  console.log(JSON.stringify({ version: data.version, dryRun, ...counts }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
