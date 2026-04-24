// api/player-photo.js — GET/POST /api/player-photo?id=X
const { getSQL } = require('./_db');

module.exports = async function handler(req, res) {
  const playerId = parseInt(req.query.id);

  if (!playerId) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  if (req.method === 'GET') {
    return getPhoto(playerId, res);
  } else if (req.method === 'POST') {
    return uploadPhoto(playerId, req, res);
  } else if (req.method === 'OPTIONS') {
    return res.status(200).end();
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

    let buf = rows[0].photo_data;
    if (!Buffer.isBuffer(buf)) {
      if (buf instanceof Uint8Array) {
        buf = Buffer.from(buf);
      } else if (typeof buf === 'string') {
        const hex = buf.startsWith('\\x') ? buf.slice(2) : buf;
        buf = Buffer.from(hex, 'hex');
      }
    }

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

    let b64 = image;
    if (b64.includes(',')) b64 = b64.split(',')[1];
    const photoBuffer = Buffer.from(b64, 'base64');

    console.log(`[PHOTO] Uploading for player ${playerId}, size: ${photoBuffer.length} bytes`);

    await sql`
      UPDATE players SET
        photo_data = ${photoBuffer},
        photo_thumbnail = ${photoBuffer},
        photo_source = 'webcam',
        photo_status = 'pending_review',
        updated_at = NOW()
      WHERE id = ${playerId}
    `;

    const player = await sql`
      SELECT name, surname, team_id FROM players WHERE id = ${playerId}
    `;

    if (player.length) {
      const pName = (player[0].name || '') + ' ' + (player[0].surname || '');
      await sql`
        INSERT INTO activity_log (action, player_id, team_id, user_name, details)
        VALUES ('photo_captured', ${playerId}, ${player[0].team_id}, ${user_name},
                ${'Foto capturada para ' + pName.trim()})
      `;
    }

    return res.json({ success: true, message: `Foto guardada para jugador #${playerId}` });
  } catch (e) {
    console.error('[PHOTO] Error uploading:', e);
    return res.status(500).json({ error: e.message });
  }
}
