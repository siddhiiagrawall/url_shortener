// ─── Migration Runner ─────────────────────────────────────────────────────────
// Runs all .sql files in the migrations/ folder in order.
// Run with: node src/config/migrate.js
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir).sort(); // sort ensures 001 before 002

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`▶ Running migration: ${file}`);
    await pool.query(sql);
    console.log(`✅ Done: ${file}`);
  }

  console.log('\n🎉 All migrations complete!');
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
