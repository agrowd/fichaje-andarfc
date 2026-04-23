# -*- coding: utf-8 -*-
"""
init_db.py — Initialization script that scans all Excel files
and populates the database with players and existing photos.
"""

import os
import sys
import io

# Force UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from db import init_db, upsert_team, upsert_player, update_team_stats, get_global_stats
from excel_manager import scan_all_excels, assess_photo_quality


def initialize():
    """Full initialization: create DB, scan Excels, import everything."""
    print("=" * 60)
    print("  FICHAJE FOTOGRAFICO - INICIALIZACION")
    print("=" * 60)

    # Step 1: Create database
    print("\n[1/3] Creando base de datos...")
    init_db()

    # Step 2: Scan all Excel files
    print("\n[2/3] Escaneando archivos Excel...")
    results = scan_all_excels()

    # Step 3: Import into database
    print("\n[3/3] Importando datos a la base de datos...")
    total_imported = 0
    total_photos = 0

    for result in results:
        team_name = result["team_name"]
        filename = result["filename"]
        sheet_name = result["sheet_name"]

        # Create/update team
        team_id = upsert_team(team_name, filename, sheet_name)
        print(f"\n  Equipo: {team_name} (ID: {team_id})")

        for player in result["players"]:
            row = player["row"]
            photo_data = result["images_by_row"].get(row)
            
            # Assess photo quality
            if photo_data:
                photo_status = assess_photo_quality(photo_data)
                photo_source = "excel"
                total_photos += 1
            else:
                photo_status = "missing"
                photo_source = None
                photo_data = None

            player_id = upsert_player(
                team_id=team_id,
                excel_row=row,
                name=player["name"],
                surname=player["surname"],
                dni=player["dni"],
                email=player["email"],
                competition=player["competition"],
                photo_status=photo_status,
                photo_data=photo_data,
                photo_source=photo_source,
            )
            total_imported += 1

        # Update team stats
        update_team_stats(team_id)

        # Print team summary
        players_count = len(result["players"])
        images_count = len(result["images_by_row"])
        unlinked = " [UNLINKED IMAGES]" if result["has_unlinked_images"] else ""
        print(f"    Jugadores: {players_count} | Fotos: {images_count}{unlinked}")

    # Final summary
    print("\n" + "=" * 60)
    print("  RESUMEN DE INICIALIZACION")
    print("=" * 60)

    stats = get_global_stats()
    print(f"\n  Equipos:           {stats['total_teams']}")
    print(f"  Jugadores totales: {stats['total_players']}")
    print(f"  Fotos OK:          {stats['photos_ok']}")
    print(f"  Fotos malas:       {stats['photos_bad']}")
    print(f"  Sin foto:          {stats['photos_missing']}")
    print(f"  En revision:       {stats['photos_in_review']}")
    print(f"  Progreso:          {stats['progress_pct']}%")
    print(f"\n  Total fotos importadas: {total_photos}")

    print("\n[OK] Inicializacion completada. Ejecuta 'python server.py' para iniciar.")
    return stats


if __name__ == "__main__":
    initialize()
