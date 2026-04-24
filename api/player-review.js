// api/player-review.js — POST /api/player-review?id=X
const { getSQL } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const playerId = parseInt(req.query.id);
  if (!playerId) return res.status(400).json({ error: 'Missing id' });

  const { status, user_name = 'Anónimo' } = req.body;

  if (!['ok', 'bad'].includes(status)) {
    return res.status(400).json({ error: "Status must be 'ok' or 'bad'" });
  }

  try {
    const sql = getSQL();

    await sql`
      UPDATE players SET
        photo_status = ${status},
        reviewed_by = ${user_name},
        updated_at = NOW()
      WHERE id = ${playerId}
    `;

    const player = await sql`
      SELECT name, surname, team_id FROM players WHERE id = ${playerId}
    `;

    if (player.length) {
      await sql`
        INSERT INTO activity_log (action, player_id, team_id, user_name, details)
        VALUES ('photo_reviewed', ${playerId}, ${player[0].team_id}, ${user_name},
                ${'Foto de ' + player[0].name + ' ' + player[0].surname + ' marcada como ' + status})
      `;
    }

    return res.json({ success: true, status });
  } catch (e) {
    console.error('Error reviewing photo:', e);
    return res.status(500).json({ error: e.message });
  }
};
