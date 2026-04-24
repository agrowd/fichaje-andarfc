# -*- coding: utf-8 -*-
"""
Update LANUS 2 in Neon + create test team
"""
import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from excel_manager import scan_excel, assess_photo_quality

EXCEL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "LISTAS DE BUENA FE AFA SOMOS TODOS 2026",
    "LANUS 2.xlsx"
)

print("=" * 60)
print("  SCANNING LANUS 2.xlsx (updated)")
print("=" * 60)

result = scan_excel(EXCEL_PATH)
print(f"\nPlayers: {len(result['players'])}")
print(f"Images found: {result['total_images']}")
print(f"Has unlinked: {result['has_unlinked_images']}")

print(f"\nImages by row:")
for row, data in sorted(result['images_by_row'].items()):
    quality = assess_photo_quality(data)
    print(f"  Row {row}: {len(data)} bytes, quality: {quality}")

print(f"\nPlayers:")
for p in result['players']:
    has_photo = "PHOTO" if p['row'] in result['images_by_row'] else "NO PHOTO"
    print(f"  Row {p['row']}: {p['name']} {p['surname']} - {has_photo}")
