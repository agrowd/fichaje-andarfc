// api/activity.js — GET /api/activity?limit=N
const { getSQL } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sql = getSQL();
    const limit = parseInt(req.query.limit) || 30;

    const entries = await sql`
      SELECT al.*, p.name as player_name, p.surname as player_surname, t.name as team_name
      FROM activity_log al
      LEFT JOIN players p ON al.player_id = p.id
      LEFT JOIN teams t ON al.team_id = t.id
      ORDER BY al.created_at DESC
      LIMIT ${limit}
    `;

    res.json(entries);
  } catch (e) {
    console.error('Error in /api/activity:', e);
    res.status(500).json({ error: e.message });
  }
};
