const ExcelJS = require('exceljs');
const { db } = require('./_db');
const path = require('path');
const fs = require('fs');

module.exports = async (req, res) => {
    try {
        const teamId = req.query.id;
        if (!teamId) {
            return res.status(400).json({ error: "Missing team id" });
        }

        const { rows: teamRows } = await db.query(
            "SELECT id, name, filename, sheet_name FROM teams WHERE id = $1",
            [teamId]
        );

        if (teamRows.length === 0) {
            return res.status(404).json({ error: "Team not found" });
        }

        const team = teamRows[0];
        const { rows: players } = await db.query(
            "SELECT excel_row, photo_data FROM players WHERE team_id = $1 AND photo_data IS NOT NULL",
            [teamId]
        );

        const templatePath = path.join(process.cwd(), 'LISTAS DE BUENA FE AFA SOMOS TODOS 2026', team.filename);
        
        if (!fs.existsSync(templatePath)) {
            return res.status(500).json({ error: `Template file not found: ${team.filename}` });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        
        const ws = workbook.getWorksheet(team.sheet_name) || workbook.worksheets[0];

        // Ensure column G is wide enough
        ws.getColumn(7).width = 25;

        for (const player of players) {
            if (!player.photo_data) continue;

            const rowIdx = parseInt(player.excel_row);
            const row = ws.getRow(rowIdx);
            row.height = 95;

            const imageId = workbook.addImage({
                buffer: player.photo_data,
                extension: 'jpeg',
            });

            // G = 7th column. Anchor is 0-indexed, so G is col 6.
            ws.addImage(imageId, {
                tl: { col: 6.1, row: rowIdx - 0.9 },
                ext: { width: 130, height: 170 }
            });
        }

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${team.name}_FOTOS.xlsx"`
        );

        const buffer = await workbook.xlsx.writeBuffer();
        res.send(buffer);

    } catch (error) {
        console.error("Export error:", error);
        res.status(500).json({ error: error.message });
    }
};
