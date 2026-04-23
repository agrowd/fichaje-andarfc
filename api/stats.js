// api/stats.js — GET /api/stats
const { getSQL } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sql = getSQL();
    const rows = await sql`
      SELECT
        COUNT(*) as total_players,
        COUNT(CASE WHEN photo_status = 'ok' THEN 1 END) as photos_ok,
        COUNT(CASE WHEN photo_status = 'bad' THEN 1 END) as photos_bad,
        COUNT(CASE WHEN photo_status = 'missing' THEN 1 END) as photos_missing,
        COUNT(CASE WHEN photo_status = 'pending_review' THEN 1 END) as photos_pending_review,
        COUNT(CASE WHEN photo_status = 'new' THEN 1 END) as photos_new
      FROM players
    `;

    const r = rows[0];
    const total = parseInt(r.total_players) || 0;
    const done = parseInt(r.photos_ok) || 0;
    const remaining = (parseInt(r.photos_missing) || 0) + (parseInt(r.photos_bad) || 0);
    const inReview = (parseInt(r.photos_pending_review) || 0) + (parseInt(r.photos_new) || 0);

    const teamCount = await sql`SELECT COUNT(*) as cnt FROM teams`;

    res.json({
      total_teams: parseInt(teamCount[0].cnt) || 0,
      total_players: total,
      photos_ok: done,
      photos_bad: parseInt(r.photos_bad) || 0,
      photos_missing: parseInt(r.photos_missing) || 0,
      photos_pending_review: parseInt(r.photos_pending_review) || 0,
      photos_new: parseInt(r.photos_new) || 0,
      photos_done: done,
      photos_remaining: remaining,
      photos_in_review: inReview,
      progress_pct: total > 0 ? Math.round((done / total) * 1000) / 10 : 0
    });
  } catch (e) {
    console.error('Error in /api/stats:', e);
    res.status(500).json({ error: e.message });
  }
};
