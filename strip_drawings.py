import openpyxl
import os

template_path = os.path.join("LISTAS DE BUENA FE AFA SOMOS TODOS 2026", "TEST.xlsx")
wb = openpyxl.load_workbook(template_path)
wb.save(template_path)
print("Re-saved TEST.xlsx with openpyxl")
