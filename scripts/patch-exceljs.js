const fs = require('fs');
const path = require('path');

const fileToPatch = path.join(process.cwd(), 'node_modules', 'exceljs', 'lib', 'xlsx', 'xform', 'sheet', 'worksheet-xform.js');

if (fs.existsSync(fileToPatch)) {
    let content = fs.readFileSync(fileToPatch, 'utf8');
    
    // The bug happens when drawing is defined but drawing.anchors is undefined.
    // The problematic code in exceljs is usually around model.drawing.anchors
    // Let's replace any iteration over drawing.anchors to add a safety check.
    content = content.replace(/model\.drawing\.anchors\.forEach/g, '(model.drawing.anchors || []).forEach');
    content = content.replace(/drawing\.anchors\.forEach/g, '(drawing.anchors || []).forEach');
    content = content.replace(/model\.drawing\.anchors/g, '(model.drawing.anchors || [])');
    
    fs.writeFileSync(fileToPatch, content, 'utf8');
    console.log('exceljs patched successfully.');
} else {
    console.log('exceljs not found, skipping patch.');
}
