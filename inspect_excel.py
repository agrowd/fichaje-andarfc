import openpyxl
import sys

def inspect_excel(filepath):
    print(f"Inspecting {filepath}")
    wb = openpyxl.load_workbook(filepath)
    ws = wb.active
    print(f"Sheet: {ws.title}")
    
    print("Images:")
    for img in ws._images:
        anchor = img.anchor
        if hasattr(anchor, '_from'):
            print(f"  TwoCellAnchor: from col {anchor._from.col} row {anchor._from.row} to col {anchor.to.col} row {anchor.to.row}")
        else:
            print(f"  OneCellAnchor: col {anchor._from.col} row {anchor._from.row}, width {anchor.ext.width}, height {anchor.ext.height}")
    
    print("Row heights:")
    for i in range(4, 8):
        print(f"  Row {i}: {ws.row_dimensions[i].height}")

if __name__ == "__main__":
    inspect_excel(sys.argv[1])
