// scripts/update-lanus2-and-create-test.js
// Updates LANUS 2 photos in Neon + creates a test team with 3 players
// Run: node scripts/update-lanus2-and-create-test.js

const { neon } = require('@neondatabase/serverless');
const path = require('path');
const sqlite3 = require('better-sqlite3');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = path.join(__dirname, '..', 'fichaje.db');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: Set DATABASE_URL in .env');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log('='.repeat(60));
  console.log('  STEP 1: UPDATE LANUS 2 PHOTOS');
  console.log('='.repeat(60));

  // First, re-run the Python scanner to update local SQLite
  const { execSync } = require('child_process');
  
  // Re-init the local DB to pick up new LANUS 2 photos
  console.log('\n  Re-scanning LANUS 2 with Python...');
  execSync('python init_db.py', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

  // Now read updated LANUS 2 data from SQLite
  console.log('\n  Reading updated data from SQLite...');
  const db = new sqlite3(DB_PATH, { readonly: true });

  // Find LANUS 2 team
  const lanusTeam = db.prepare("SELECT * FROM teams WHERE name LIKE '%LANUS 2%'").get();
  if (!lanusTeam) {
    console.error('ERROR: LANUS 2 team not found in SQLite');
    process.exit(1);
  }

  console.log(`  Found: ${lanusTeam.name} (ID: ${lanusTeam.id})`);

  const lanusPlayers = db.prepare("SELECT * FROM players WHERE team_id = ? ORDER BY excel_row").all(lanusTeam.id);
  console.log(`  Players: ${lanusPlayers.length}`);
  console.log(`  With photos: ${lanusPlayers.filter(p => p.photo_data).length}`);

  // Update each player in Neon
  let updatedCount = 0;
  for (const p of lanusPlayers) {
    if (p.photo_data) {
      const photoBuf = Buffer.isBuffer(p.photo_data) ? p.photo_data : Buffer.from(p.photo_data);
      const photoHex = '\\x' + photoBuf.toString('hex');

      let thumbHex = photoHex;
      if (p.photo_thumbnail) {
        const thumbBuf = Buffer.isBuffer(p.photo_thumbnail) ? p.photo_thumbnail : Buffer.from(p.photo_thumbnail);
        thumbHex = '\\x' + thumbBuf.toString('hex');
      }

      await sql`
        UPDATE players SET
          photo_data = ${photoHex}::bytea,
          photo_thumbnail = ${thumbHex}::bytea,
          photo_source = ${p.photo_source || 'excel'},
          photo_status = ${p.photo_status || 'ok'},
          photo_width = ${p.photo_width},
          photo_height = ${p.photo_height},
          updated_at = NOW()
        WHERE team_id = (SELECT id FROM teams WHERE name LIKE '%LANUS 2%')
          AND excel_row = ${p.excel_row}
      `;
      updatedCount++;
      process.stdout.write(`  Updated row ${p.excel_row}: ${p.name} ${p.surname}\r\n`);
    }
  }

  console.log(`\n  ✓ Updated ${updatedCount} photos for LANUS 2`);

  db.close();

  // ─── STEP 2: CREATE TEST TEAM ───────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('  STEP 2: CREATE TEST TEAM');
  console.log('='.repeat(60));

  // Check if test team already exists
  const existingTest = await sql`SELECT id FROM teams WHERE name = 'EQUIPO TEST'`;
  if (existingTest.length > 0) {
    // Delete existing test team and its players
    await sql`DELETE FROM players WHERE team_id = ${existingTest[0].id}`;
    await sql`DELETE FROM teams WHERE id = ${existingTest[0].id}`;
    console.log('  Deleted existing test team');
  }

  // Create test team
  const newTeam = await sql`
    INSERT INTO teams (name, filename, sheet_name)
    VALUES ('EQUIPO TEST', 'TEST.xlsx', 'Data')
    RETURNING id
  `;
  const testTeamId = newTeam[0].id;
  console.log(`  Created team: EQUIPO TEST (ID: ${testTeamId})`);

  // Create 3 test players with NO photos (so user can test fichaje)
  const testPlayers = [
    { name: 'Juan Carlos', surname: 'Pérez', dni: '40123456', email: 'juan@test.com', row: 4 },
    { name: 'María', surname: 'González', dni: '41234567', email: 'maria@test.com', row: 5 },
    { name: 'Pedro', surname: 'Rodríguez', dni: '42345678', email: 'pedro@test.com', row: 6 },
  ];

  for (const p of testPlayers) {
    await sql`
      INSERT INTO players (team_id, excel_row, name, surname, dni, email, competition, photo_status)
      VALUES (${testTeamId}, ${p.row}, ${p.name}, ${p.surname}, ${p.dni}, ${p.email}, 'AFA Somos Todos 2026', 'missing')
    `;
    console.log(`  Added: ${p.name} ${p.surname} (DNI: ${p.dni}) — SIN FOTO`);
  }

  console.log(`\n  ✓ Test team created with 3 players ready for fichaje`);

  // ─── VERIFY ─────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('  VERIFICATION');
  console.log('='.repeat(60));

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

  // Check LANUS 2 specifically
  const lanus2Check = await sql`
    SELECT COUNT(*) as total,
           COUNT(CASE WHEN photo_data IS NOT NULL THEN 1 END) as with_photos
    FROM players
    WHERE team_id = (SELECT id FROM teams WHERE name LIKE '%LANUS 2%')
  `;
  console.log(`\n  LANUS 2: ${lanus2Check[0].with_photos}/${lanus2Check[0].total} photos`);

  // Check test team
  const testCheck = await sql`
    SELECT COUNT(*) as total,
           COUNT(CASE WHEN photo_status = 'missing' THEN 1 END) as missing
    FROM players
    WHERE team_id = ${testTeamId}
  `;
  console.log(`  EQUIPO TEST: ${testCheck[0].total} players, ${testCheck[0].missing} sin foto (listo para fichar)`);

  console.log('\n' + '='.repeat(60));
  console.log('  DONE! Open https://fichaje-andarfc.vercel.app to test');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
