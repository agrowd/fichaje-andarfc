// api/teams.js — GET /api/teams
const { getSQL } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sql = getSQL();
    const teams = await sql`
      SELECT 
        t.id, t.name, t.filename, t.sheet_name,
        COUNT(p.id) as total_players,
        COUNT(CASE WHEN p.photo_status = 'ok' THEN 1 END) as photos_ok,
        COUNT(CASE WHEN p.photo_status = 'bad' THEN 1 END) as photos_bad,
        COUNT(CASE WHEN p.photo_status = 'missing' THEN 1 END) as photos_missing,
        COUNT(CASE WHEN p.photo_status IN ('pending_review', 'new') THEN 1 END) as photos_pending
      FROM teams t
      LEFT JOIN players p ON p.team_id = t.id
      GROUP BY t.id, t.name, t.filename, t.sheet_name
      ORDER BY t.name
    `;
    res.json(teams);
  } catch (e) {
    console.error('Error in /api/teams:', e);
    res.status(500).json({ error: e.message });
  }
};
