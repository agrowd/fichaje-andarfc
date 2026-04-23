// api/players.js — GET /api/players?team_id=X&status=Y
const { getSQL } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sql = getSQL();
    const { team_id, status } = req.query;

    let query;
    if (team_id && status && status !== 'all') {
      let statusFilter;
      if (status === 'missing') statusFilter = ['missing', 'bad'];
      else if (status === 'needs_work') statusFilter = ['missing', 'bad', 'pending_review'];
      else if (status === 'done') statusFilter = ['ok'];
      else if (status === 'pending') statusFilter = ['pending_review', 'new'];
      else statusFilter = [status];

      query = sql`
        SELECT id, team_id, excel_row, name, surname, dni, email, competition,
               photo_status, photo_source, photo_width, photo_height, reviewed_by
        FROM players
        WHERE team_id = ${parseInt(team_id)} AND photo_status = ANY(${statusFilter})
        ORDER BY excel_row
      `;
    } else if (team_id) {
      query = sql`
        SELECT id, team_id, excel_row, name, surname, dni, email, competition,
               photo_status, photo_source, photo_width, photo_height, reviewed_by
        FROM players
        WHERE team_id = ${parseInt(team_id)}
        ORDER BY excel_row
      `;
    } else {
      query = sql`
        SELECT id, team_id, excel_row, name, surname, dni, email, competition,
               photo_status, photo_source, photo_width, photo_height, reviewed_by
        FROM players
        ORDER BY team_id, excel_row
        LIMIT 500
      `;
    }

    const players = await query;
    res.json(players);
  } catch (e) {
    console.error('Error in /api/players:', e);
    res.status(500).json({ error: e.message });
  }
};
