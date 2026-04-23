# -*- coding: utf-8 -*-
"""
server.py — Flask API server for the Photo Registration System.
Multi-user support via SSE (Server-Sent Events).
"""

import os
import sys
import io
import json
import base64
import time
import queue
import threading
from datetime import datetime

from flask import Flask, request, jsonify, send_from_directory, Response, send_file
from flask_cors import CORS

from db import (
    init_db, get_teams, get_players, get_player, get_player_photo,
    get_player_thumbnail, update_player_photo, update_player_review,
    get_activity_log, get_global_stats, update_team_stats
)
from excel_manager import export_excel_with_photos, EXPORT_DIR

# Force UTF-8
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    except Exception:
        pass

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# SSE: message queues for connected clients
sse_clients = []
sse_lock = threading.Lock()


def broadcast_event(event_type, data):
    """Send an SSE event to all connected clients."""
    message = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    dead_clients = []
    with sse_lock:
        for q in sse_clients:
            try:
                q.put_nowait(message)
            except queue.Full:
                dead_clients.append(q)
        for q in dead_clients:
            sse_clients.remove(q)


# ─── Static Files ────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


# ─── API: Teams ──────────────────────────────────────────────

@app.route('/api/teams')
def api_teams():
    teams = get_teams()
    return jsonify(teams)


# ─── API: Players ────────────────────────────────────────────

@app.route('/api/players')
def api_players():
    team_id = request.args.get('team_id', type=int)
    status = request.args.get('status')
    players = get_players(team_id=team_id, status_filter=status)
    return jsonify(players)


@app.route('/api/player/<int:player_id>')
def api_player(player_id):
    player = get_player(player_id)
    if not player:
        return jsonify({"error": "Player not found"}), 404
    return jsonify(player)


# ─── API: Photos ─────────────────────────────────────────────

@app.route('/api/player/<int:player_id>/photo')
def api_player_photo(player_id):
    """Get the full photo for a player."""
    photo_data, status = get_player_photo(player_id)
    if not photo_data:
        return jsonify({"error": "No photo available"}), 404
    return Response(photo_data, mimetype='image/jpeg')


@app.route('/api/player/<int:player_id>/thumbnail')
def api_player_thumbnail(player_id):
    """Get the thumbnail for a player."""
    thumb = get_player_thumbnail(player_id)
    if not thumb:
        # Return a 1x1 transparent pixel as fallback
        return Response(
            base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
            mimetype='image/png'
        )
    return Response(thumb, mimetype='image/jpeg')


@app.route('/api/player/<int:player_id>/photo', methods=['POST'])
def api_upload_photo(player_id):
    """Upload a photo for a player. Accepts base64 image data."""
    data = request.get_json()

    if not data or 'image' not in data:
        return jsonify({"error": "No image data provided"}), 400

    user_name = data.get('user_name', 'Anónimo')

    try:
        # Parse base64 image
        image_b64 = data['image']
        # Remove data URL prefix if present
        if ',' in image_b64:
            image_b64 = image_b64.split(',', 1)[1]

        photo_bytes = base64.b64decode(image_b64)

        # Get dimensions
        from PIL import Image as PILImage
        img = PILImage.open(io.BytesIO(photo_bytes))
        width, height = img.size

        # Convert to JPEG if needed
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        jpeg_buffer = io.BytesIO()
        img.save(jpeg_buffer, format="JPEG", quality=90)
        photo_bytes = jpeg_buffer.getvalue()

        # Save to database
        update_player_photo(
            player_id=player_id,
            photo_data=photo_bytes,
            photo_source="webcam",
            photo_status="pending_review",
            photo_width=width,
            photo_height=height,
            user_name=user_name
        )

        # Update team stats
        player = get_player(player_id)
        if player:
            update_team_stats(player['team_id'])

        # Broadcast SSE event
        broadcast_event("photo_captured", {
            "player_id": player_id,
            "player_name": player['name'] if player else '',
            "player_surname": player['surname'] if player else '',
            "team_id": player['team_id'] if player else None,
            "user_name": user_name,
            "timestamp": datetime.now().isoformat()
        })

        return jsonify({
            "success": True,
            "message": f"Foto guardada para jugador #{player_id}",
            "width": width,
            "height": height
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/player/<int:player_id>/review', methods=['POST'])
def api_review_photo(player_id):
    """Review a photo — mark as 'ok' or 'bad'."""
    data = request.get_json()
    status = data.get('status')
    reviewer = data.get('user_name', 'Anónimo')

    if status not in ('ok', 'bad'):
        return jsonify({"error": "Status must be 'ok' or 'bad'"}), 400

    update_player_review(player_id, status, reviewer)

    player = get_player(player_id)
    if player:
        update_team_stats(player['team_id'])

    # Broadcast SSE event
    broadcast_event("photo_reviewed", {
        "player_id": player_id,
        "status": status,
        "reviewer": reviewer,
        "timestamp": datetime.now().isoformat()
    })

    return jsonify({"success": True, "status": status})


# ─── API: Export ─────────────────────────────────────────────

@app.route('/api/export/<int:team_id>')
def api_export_team(team_id):
    """Export a team's Excel with photos embedded."""
    teams = get_teams()
    team = next((t for t in teams if t['id'] == team_id), None)

    if not team:
        return jsonify({"error": "Team not found"}), 404

    # Get all players with photos
    players = get_players(team_id=team_id)
    players_with_photos = []

    from db import get_player_photo as _get_photo
    for p in players:
        photo_data, _ = _get_photo(p['id'])
        if photo_data:
            players_with_photos.append({
                "excel_row": p['excel_row'],
                "photo_data": photo_data
            })

    try:
        export_path = export_excel_with_photos(team['filename'], players_with_photos)
        return send_file(
            export_path,
            as_attachment=True,
            download_name=team['filename'],
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── API: Stats ──────────────────────────────────────────────

@app.route('/api/stats')
def api_stats():
    return jsonify(get_global_stats())


@app.route('/api/activity')
def api_activity():
    limit = request.args.get('limit', 30, type=int)
    return jsonify(get_activity_log(limit=limit))


# ─── SSE: Real-time Events ──────────────────────────────────

@app.route('/api/events')
def sse_stream():
    """Server-Sent Events endpoint for real-time updates."""
    def event_stream():
        q = queue.Queue(maxsize=100)
        with sse_lock:
            sse_clients.append(q)
        try:
            # Send initial connection event
            yield f"event: connected\ndata: {json.dumps({'message': 'Connected'})}\n\n"
            while True:
                try:
                    message = q.get(timeout=30)
                    yield message
                except queue.Empty:
                    # Send keepalive
                    yield f": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with sse_lock:
                if q in sse_clients:
                    sse_clients.remove(q)

    return Response(
        event_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )


# ─── Main ────────────────────────────────────────────────────

if __name__ == '__main__':
    # Ensure DB exists
    init_db()
    os.makedirs(EXPORT_DIR, exist_ok=True)

    print("\n" + "=" * 60)
    print("  FICHAJE FOTOGRAFICO - AFA SOMOS TODOS 2026")
    print("  Servidor iniciado en http://localhost:5000")
    print("  Conecta desde cualquier dispositivo en la misma red")
    print("=" * 60 + "\n")

    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
