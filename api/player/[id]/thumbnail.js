// api/player/[id]/thumbnail.js — GET thumbnail
const { getSQL } = require('../../_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const playerId = parseInt(req.query.id);

  try {
    const sql = getSQL();
    const rows = await sql`
      SELECT photo_thumbnail FROM players WHERE id = ${playerId}
    `;

    if (!rows.length || !rows[0].photo_thumbnail) {
      // Return 1x1 transparent pixel
      const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(pixel);
    }

    const buf = Buffer.from(rows[0].photo_thumbnail, 'hex');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.send(buf);
  } catch (e) {
    console.error('Error getting thumbnail:', e);
    return res.status(500).json({ error: e.message });
  }
};
