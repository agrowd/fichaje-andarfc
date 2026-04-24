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

    // Neon returns bytea as Buffer or Uint8Array
    let buf = rows[0].photo_thumbnail;
    if (!Buffer.isBuffer(buf)) {
      if (buf instanceof Uint8Array) {
        buf = Buffer.from(buf);
      } else if (typeof buf === 'string') {
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
