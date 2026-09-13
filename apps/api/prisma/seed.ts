import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

// The source vision deck (referenced by docs/checkpoints/CP01-data-model.md
// and docs/production-plan.md Part 6) is not a file present in this repo —
// only the restaurant's name ("Spice Route") and one worked timing scenario
// (Part 6, CP6: order 7:52, arrival 8:15, kitchen start 7:58, food out 8:18)
// are documented anywhere. The specific menu items, prices, and table
// layout below are reasonable placeholder fixtures in that spirit, not a
// literal transcription of unseen deck slides. Swap them for the real
// deck's numbers if/when the deck itself is available.
//
// Idempotent by design (fixed ids + upsert): safe to run `prisma db seed`
// more than once without creating duplicates.

loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const RESTAURANT_ID = 'demo-spice-route';

async function main() {
  console.log('Seeding demo restaurant "Spice Route"...');

  const restaurant = await prisma.restaurant.upsert({
    where: { id: RESTAURANT_ID },
    update: {},
    create: {
      id: RESTAURANT_ID,
      name: 'Spice Route',
      timezone: 'America/Los_Angeles',
      address: '221 Market Street, San Francisco, CA 94105',
      phone: '+14155550142',
      settings: {
        avgPrepBufferMinutes: 5,
        tableHoldWindowMinutes: 20,
      },
    },
  });

  const menuItems = [
    {
      id: 'demo-menu-samosa-chaat',
      name: 'Samosa Chaat',
      description: 'Crisp samosas, tamarind chutney, yogurt, sev.',
      price: '8.50',
      prepTimeMinutes: 8,
      allergens: ['gluten', 'dairy'],
      modifiableOptions: [],
      category: 'starter',
    },
    {
      id: 'demo-menu-paneer-tikka',
      name: 'Paneer Tikka Masala',
      description: 'Charred paneer in a spiced tomato-cream sauce.',
      price: '16.00',
      prepTimeMinutes: 15,
      allergens: ['dairy'],
      modifiableOptions: ['spice_level'],
      category: 'main',
    },
    {
      id: 'demo-menu-butter-chicken',
      name: 'Butter Chicken',
      description: 'Classic murgh makhani, mild and rich.',
      price: '18.00',
      prepTimeMinutes: 18,
      allergens: ['dairy'],
      modifiableOptions: ['spice_level'],
      category: 'main',
    },
    {
      id: 'demo-menu-chicken-biryani',
      name: 'Chicken Biryani',
      description: 'Basmati rice layered with spiced chicken.',
      price: '19.00',
      prepTimeMinutes: 20,
      allergens: [],
      modifiableOptions: ['spice_level'],
      category: 'main',
    },
    {
      id: 'demo-menu-dal-makhani',
      name: 'Dal Makhani',
      description: 'Slow-cooked black lentils, butter, cream.',
      price: '14.00',
      prepTimeMinutes: 12,
      allergens: ['dairy'],
      modifiableOptions: [],
      category: 'main',
    },
    {
      id: 'demo-menu-garlic-naan',
      name: 'Garlic Naan',
      description: 'Tandoor-baked flatbread, garlic and butter.',
      price: '4.00',
      prepTimeMinutes: 6,
      allergens: ['gluten', 'dairy'],
      modifiableOptions: [],
      category: 'bread',
    },
    {
      id: 'demo-menu-mango-lassi',
      name: 'Mango Lassi',
      description: 'Yogurt, mango, a touch of cardamom.',
      price: '5.00',
      prepTimeMinutes: 3,
      allergens: ['dairy'],
      modifiableOptions: [],
      category: 'beverage',
    },
  ];

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: { ...item, restaurantId: restaurant.id, available: true },
    });
  }

  const tables = [
    { id: 'demo-table-t1', label: 'T1', seatsMin: 2, seatsMax: 2, features: [] },
    { id: 'demo-table-t2', label: 'T2', seatsMin: 2, seatsMax: 4, features: ['high_chair_ok'] },
    { id: 'demo-table-t4', label: 'T4', seatsMin: 4, seatsMax: 6, features: ['high_chair_ok'] },
    { id: 'demo-table-t7', label: 'T7 (Patio)', seatsMin: 2, seatsMax: 4, features: ['patio'] },
  ];

  for (const table of tables) {
    await prisma.table.upsert({
      where: { id: table.id },
      update: {},
      create: { ...table, restaurantId: restaurant.id },
    });
  }

  console.log(
    `Seeded restaurant "${restaurant.name}" (${restaurant.id}) with ${menuItems.length} menu items and ${tables.length} tables.`,
  );
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
