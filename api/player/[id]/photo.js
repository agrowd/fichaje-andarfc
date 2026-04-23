// api/player/[id]/photo.js — GET (serve photo) / POST (upload photo)
const { getSQL } = require('../../_db');

module.exports = async function handler(req, res) {
  const { id } = req.query;
  const playerId = parseInt(id);

  if (req.method === 'GET') {
    return getPhoto(playerId, res);
  } else if (req.method === 'POST') {
    return uploadPhoto(playerId, req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
};

async function getPhoto(playerId, res) {
  try {
    const sql = getSQL();
    const rows = await sql`
      SELECT photo_data FROM players WHERE id = ${playerId}
    `;

    if (!rows.length || !rows[0].photo_data) {
      return res.status(404).json({ error: 'No photo' });
    }

    // photo_data is stored as hex in bytea, convert to Buffer
    const buf = Buffer.from(rows[0].photo_data, 'hex');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.send(buf);
  } catch (e) {
    console.error('Error getting photo:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function uploadPhoto(playerId, req, res) {
  try {
    const sql = getSQL();
    const { image, user_name = 'Anónimo' } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image data' });
    }

    // Parse base64
    let b64 = image;
    if (b64.includes(',')) b64 = b64.split(',')[1];
    const photoBuffer = Buffer.from(b64, 'base64');

    // Store in DB as bytea hex
    const hexData = '\\x' + photoBuffer.toString('hex');

    // Create a simple thumbnail (just store at reduced quality, first 20KB)
    // For serverless, we skip heavy image processing and store as-is
    const thumbHex = hexData; // Same for now, frontend will scale via CSS

    await sql`
      UPDATE players SET
        photo_data = ${hexData}::bytea,
        photo_thumbnail = ${thumbHex}::bytea,
        photo_source = 'webcam',
        photo_status = 'pending_review',
        updated_at = NOW()
      WHERE id = ${playerId}
    `;

    // Get player info for logging
    const player = await sql`
      SELECT name, surname, team_id FROM players WHERE id = ${playerId}
    `;

    if (player.length) {
      await sql`
        INSERT INTO activity_log (action, player_id, team_id, user_name, details)
        VALUES ('photo_captured', ${playerId}, ${player[0].team_id}, ${user_name},
                ${'Foto capturada para ' + player[0].name + ' ' + player[0].surname})
      `;
    }

    return res.json({
      success: true,
      message: `Foto guardada para jugador #${playerId}`
    });
  } catch (e) {
    console.error('Error uploading photo:', e);
    return res.status(500).json({ error: e.message });
  }
}
