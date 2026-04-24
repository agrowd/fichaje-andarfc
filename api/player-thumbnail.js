// api/player-thumbnail.js — GET /api/player-thumbnail?id=X
const { getSQL } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const playerId = parseInt(req.query.id);
  if (!playerId) return res.status(400).json({ error: 'Missing id' });

  try {
    const sql = getSQL();
    const rows = await sql`
      SELECT photo_thumbnail FROM players WHERE id = ${playerId}
    `;

    if (!rows.length || !rows[0].photo_thumbnail) {
      const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(pixel);
    }

    let buf = rows[0].photo_thumbnail;
    if (!Buffer.isBuffer(buf)) {
      if (buf instanceof Uint8Array) buf = Buffer.from(buf);
      else if (typeof buf === 'string') {
        const hex = buf.startsWith('\\x') ? buf.slice(2) : buf;
        buf = Buffer.from(hex, 'hex');
      }
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.send(buf);
  } catch (e) {
    console.error('Error getting thumbnail:', e);
    return res.status(500).json({ error: e.message });
  }
};
