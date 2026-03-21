// Seed the first project into Hunter's autonomous pipeline
// Run once: npx tsx src/hunter/seed_first_project.ts

import 'dotenv/config';
import { create_project_db } from './project_db.js';
import { load_hunter_config } from './config.js';

const config = load_hunter_config();
const db = create_project_db({ db_path: config.autonomous_db_path });

// Check if MoneyPrinterV2 already exists
const existing = db.get_all().find(
  (p) => p.title.toLowerCase().includes('moneyprinter'),
);

if (existing) {
  console.log(`MoneyPrinterV2 already registered (id: ${existing.id}, status: ${existing.status})`);
} else {
  const project = db.create({
    title: 'MoneyPrinterV2 Korean Adaptation',
    category: 'youtube_shorts_automation',
    expected_revenue: '월 10~50만원',
    resources_needed: [
      'ffmpeg',
      'yt-dlp',
      'Korean TTS',
      'YouTube channel (owner approval needed)',
    ],
  });

  console.log(`MoneyPrinterV2 registered as first project:`);
  console.log(`  ID: ${project.id}`);
  console.log(`  Status: ${project.status}`);
  console.log(`  Category: ${project.category}`);
  console.log(`  Expected revenue: ${project.expected_revenue}`);
  console.log(`  Resources: ${project.resources_needed.join(', ')}`);
}

db.close();
