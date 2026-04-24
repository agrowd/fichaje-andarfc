// api/export.js
const { getSQL } = require('./_db');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const teamId = parseInt(req.query.id);
  if (!teamId) return res.status(400).json({ error: 'Missing team id' });

  try {
    const sql = getSQL();
    
    // Get team info
    const teams = await sql`SELECT * FROM teams WHERE id = ${teamId}`;
    if (!teams.length) return res.status(404).json({ error: 'Team not found' });
    const team = teams[0];

    // Get players with photos for this team
    const players = await sql`
      SELECT excel_row, photo_data 
      FROM players 
      WHERE team_id = ${teamId} AND photo_data IS NOT NULL
    `;

    // Locate the template file
    const templatePath = path.join(process.cwd(), 'LISTAS DE BUENA FE AFA SOMOS TODOS 2026', team.filename);
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: `Template file not found: ${team.filename}` });
    }

    // Load workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    
    const ws = workbook.getWorksheet(team.sheet_name) || workbook.worksheets[0];

    // Set Column G width (similar to AFA format)
    const colG = ws.getColumn(7); // A=1, G=7
    colG.width = 25;

    // Add photos
    for (const p of players) {
      if (!p.photo_data) continue;

      const rowIdx = parseInt(p.excel_row);
      
      // Set row height (95pt is approx 126 pixels)
      const row = ws.getRow(rowIdx);
      row.height = 95;

      // Extract Buffer from bytea
      let buf = p.photo_data;
      if (!Buffer.isBuffer(buf)) {
        if (buf instanceof Uint8Array) buf = Buffer.from(buf);
        else if (typeof buf === 'string') {
          const hex = buf.startsWith('\\x') ? buf.slice(2) : buf;
          buf = Buffer.from(hex, 'hex');
        }
      }

      // Add image to workbook
      const imageId = workbook.addImage({
        buffer: buf,
        extension: 'jpeg',
      });

      // Add image to worksheet with oneCellAnchor style (top-left + explicit width/height)
      // ExcelJS uses 0-based index for columns and rows in tl (A=0, G=6. row 1 = 0)
      ws.addImage(imageId, {
        tl: { col: 6.1, row: rowIdx - 0.9 }, // slight offset to fit inside cell borders
        ext: { width: 130, height: 170 } // carnet size
      });
    }

    // Export to buffer
    const outBuffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${team.name}_FOTOS.xlsx"`);
    res.setHeader('Cache-Control', 'no-store, no-cache');
    
    return res.send(Buffer.from(outBuffer));
    
  } catch (e) {
    console.error('Export error:', e);
    return res.status(500).json({ error: e.message });
  }
};
