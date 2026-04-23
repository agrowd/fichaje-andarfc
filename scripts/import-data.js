// scripts/import-data.js — Import Excel data + photos into Neon PostgreSQL
// Run: node scripts/import-data.js
// Requires: DATABASE_URL env var

const { neon } = require('@neondatabase/serverless');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('better-sqlite3'); // We'll use the existing SQLite DB

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = path.join(__dirname, '..', 'fichaje.db');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: Set DATABASE_URL in .env');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log('='.repeat(60));
  console.log('  IMPORT DATA TO NEON');
  console.log('='.repeat(60));

  // 1. Create tables
  console.log('\n[1/4] Creating tables...');
  await sql`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      sheet_name TEXT DEFAULT 'Data',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      excel_row INTEGER NOT NULL,
      name TEXT,
      surname TEXT,
      dni TEXT,
      email TEXT,
      competition TEXT,
      photo_status TEXT DEFAULT 'missing',
      photo_data BYTEA,
      photo_thumbnail BYTEA,
      photo_source TEXT,
      photo_width INTEGER,
      photo_height INTEGER,
      reviewed_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      player_id INTEGER REFERENCES players(id),
      team_id INTEGER REFERENCES teams(id),
      user_name TEXT,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_players_status ON players(photo_status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC)`;

  console.log('  Tables created.');

  // 2. Check if SQLite DB exists
  if (!fs.existsSync(DB_PATH)) {
    console.log('\nNo SQLite DB found. Run "python init_db.py" first to populate local DB.');
    console.log('Then run this script again to migrate to Neon.');
    process.exit(1);
  }

  // 3. Read from SQLite
  console.log('\n[2/4] Reading from SQLite...');
  const db = new sqlite3(DB_PATH, { readonly: true });

  const teams = db.prepare('SELECT * FROM teams ORDER BY id').all();
  const players = db.prepare('SELECT * FROM players ORDER BY id').all();

  console.log(`  Teams: ${teams.length}`);
  console.log(`  Players: ${players.length}`);
  console.log(`  Players with photos: ${players.filter(p => p.photo_data).length}`);

  // 4. Clear and insert into Neon
  console.log('\n[3/4] Inserting into Neon...');

  // Clear existing data
  await sql`DELETE FROM activity_log`;
  await sql`DELETE FROM players`;
  await sql`DELETE FROM teams`;

  // Reset sequences
  await sql`ALTER SEQUENCE teams_id_seq RESTART WITH 1`;
  await sql`ALTER SEQUENCE players_id_seq RESTART WITH 1`;

  // Insert teams
  for (const t of teams) {
    await sql`
      INSERT INTO teams (id, name, filename, sheet_name)
      VALUES (${t.id}, ${t.name}, ${t.filename}, ${t.sheet_name})
    `;
  }
  // Update sequence
  if (teams.length > 0) {
    const maxTeamId = Math.max(...teams.map(t => t.id));
    await sql`SELECT setval('teams_id_seq', ${maxTeamId})`;
  }
  console.log(`  Teams inserted: ${teams.length}`);

  // Insert players (batch by team)
  let photoCount = 0;
  let playerCount = 0;

  for (const t of teams) {
    const teamPlayers = players.filter(p => p.team_id === t.id);

    for (const p of teamPlayers) {
      let photoHex = null;
      let thumbHex = null;

      if (p.photo_data) {
        const photoBuf = Buffer.isBuffer(p.photo_data) ? p.photo_data : Buffer.from(p.photo_data);
        photoHex = '\\x' + photoBuf.toString('hex');
        photoCount++;

        if (p.photo_thumbnail) {
          const thumbBuf = Buffer.isBuffer(p.photo_thumbnail) ? p.photo_thumbnail : Buffer.from(p.photo_thumbnail);
          thumbHex = '\\x' + thumbBuf.toString('hex');
        } else {
          thumbHex = photoHex; // Use full photo as thumbnail fallback
        }
      }

      await sql`
        INSERT INTO players (id, team_id, excel_row, name, surname, dni, email, competition,
                            photo_status, photo_data, photo_thumbnail, photo_source,
                            photo_width, photo_height, reviewed_by)
        VALUES (${p.id}, ${p.team_id}, ${p.excel_row}, ${p.name}, ${p.surname},
                ${p.dni}, ${p.email}, ${p.competition}, ${p.photo_status},
                ${photoHex ? sql`${photoHex}::bytea` : null},
                ${thumbHex ? sql`${thumbHex}::bytea` : null},
                ${p.photo_source}, ${p.photo_width}, ${p.photo_height}, ${p.reviewed_by})
      `;
      playerCount++;
    }

    process.stdout.write(`  Team ${t.name}: ${teamPlayers.length} players\r\n`);
  }

  // Update sequence
  if (players.length > 0) {
    const maxPlayerId = Math.max(...players.map(p => p.id));
    await sql`SELECT setval('players_id_seq', ${maxPlayerId})`;
  }

  db.close();

  // 5. Verify
  console.log('\n[4/4] Verifying...');
  const verify = await sql`
    SELECT
      (SELECT COUNT(*) FROM teams) as teams,
      (SELECT COUNT(*) FROM players) as players,
      (SELECT COUNT(*) FROM players WHERE photo_data IS NOT NULL) as with_photos,
      (SELECT COUNT(*) FROM players WHERE photo_status = 'ok') as photos_ok,
      (SELECT COUNT(*) FROM players WHERE photo_status = 'missing') as photos_missing
  `;

  const v = verify[0];
  console.log(`  Teams: ${v.teams}`);
  console.log(`  Players: ${v.players}`);
  console.log(`  With photos: ${v.with_photos}`);
  console.log(`  Photos OK: ${v.photos_ok}`);
  console.log(`  Missing: ${v.photos_missing}`);

  console.log('\n' + '='.repeat(60));
  console.log('  IMPORT COMPLETE');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
