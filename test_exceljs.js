const ExcelJS = require('exceljs');
const path = require('path');

async function test() {
    const templatePath = path.join(process.cwd(), 'LISTAS DE BUENA FE AFA SOMOS TODOS 2026', 'TEST.xlsx');
    const workbook = new ExcelJS.Workbook();
    try {
        console.log("Reading workbook...");
        await workbook.xlsx.readFile(templatePath);
        console.log("Workbook read successfully.");
    } catch (e) {
        console.error("Error reading workbook:", e.message);
    }
}
test();
