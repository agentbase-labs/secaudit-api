import 'reflect-metadata';
import { AppDataSource } from './data-source';

async function main() {
  const ds = await AppDataSource.initialize();
  try {
    const migrations = await ds.runMigrations({ transaction: 'each' });
    console.log(`✓ Ran ${migrations.length} migration(s):`);
    for (const m of migrations) console.log(`  - ${m.name}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
