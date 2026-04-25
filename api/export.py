from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import psycopg2
import os
import openpyxl
from openpyxl.drawing.image import Image as OpenpyxlImage
from PIL import Image as PILImage
import io

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            parsed_path = urlparse(self.path)
            query = parse_qs(parsed_path.query)
            team_id = query.get('id', [None])[0]
            
            if not team_id:
                self.send_error(400, "Missing team id")
                return
                
            team_id = int(team_id)
            
            # Connect to Neon Postgres
            conn = psycopg2.connect(os.environ.get('DATABASE_URL'))
            cur = conn.cursor()
            
            # Get team info
            cur.execute("SELECT id, name, filename, sheet_name FROM teams WHERE id = %s", (team_id,))
            team = cur.fetchone()
            
            if not team:
                self.send_error(404, "Team not found")
                cur.close()
                conn.close()
                return
                
            t_name, t_filename, t_sheet = team[1], team[2], team[3]
            
            # Get players with photos
            cur.execute("SELECT excel_row, photo_data FROM players WHERE team_id = %s AND photo_data IS NOT NULL", (team_id,))
            players = cur.fetchall()
            
            cur.close()
            conn.close()
            
            # Find template via Vercel static CDN or GitHub raw
            import urllib.request
            import urllib.parse
            
            # Since Vercel serves the static files in the repository:
            encoded_filename = urllib.parse.quote(t_filename)
            url = f"https://raw.githubusercontent.com/agrowd/fichaje-andarfc/main/LISTAS%20DE%20BUENA%20FE%20AFA%20SOMOS%20TODOS%202026/{encoded_filename}"
            
            try:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req) as response:
                    template_data = response.read()
            except Exception as url_e:
                # Fallback to Vercel URL if GitHub raw fails
                fallback_url = f"https://fichaje-andarfc.vercel.app/LISTAS%20DE%20BUENA%20FE%20AFA%20SOMOS%20TODOS%202026/{encoded_filename}"
                req = urllib.request.Request(fallback_url)
                with urllib.request.urlopen(req) as response:
                    template_data = response.read()
                
            # Process Excel
            wb = openpyxl.load_workbook(io.BytesIO(template_data))
            ws = wb[t_sheet] if t_sheet in wb.sheetnames else wb.active
            
            # Clear old images (clean up the template)
            ws._images = []
            ws.column_dimensions['G'].width = 25
            
            for p_row, photo_bytes in players:
                if not photo_bytes:
                    continue
                
                # In PostgreSQL, bytea might be returned as memoryview or bytes
                if isinstance(photo_bytes, memoryview):
                    photo_bytes = photo_bytes.tobytes()
                    
                # Set row height
                ws.row_dimensions[p_row].height = 95
                
                # Resize image
                img_stream = io.BytesIO(photo_bytes)
                pil_img = PILImage.open(img_stream)
                
                target_w, target_h = 130, 170
                orig_w, orig_h = pil_img.size
                ratio = min(target_w / orig_w, target_h / orig_h)
                new_w, new_h = int(orig_w * ratio), int(orig_h * ratio)
                
                pil_img = pil_img.resize((new_w, new_h), PILImage.Resampling.LANCZOS)
                if pil_img.mode in ("RGBA", "P"):
                    pil_img = pil_img.convert("RGB")
                    
                resized_stream = io.BytesIO()
                pil_img.save(resized_stream, format="JPEG", quality=90)
                resized_stream.seek(0)
                
                xl_img = OpenpyxlImage(resized_stream)
                
                # Match original oneCellAnchor behavior
                col_idx = 6 # G (0-indexed A=0)
                row_idx = p_row - 1 # 0-indexed
                
                marker = openpyxl.drawing.spreadsheet_drawing.OneCellAnchor(
                    _from=openpyxl.drawing.spreadsheet_drawing.AnchorMarker(col=col_idx, colOff=0, row=row_idx, rowOff=0),
                    ext=openpyxl.drawing.xdr.XDRPositiveSize2D(cx=new_w * 9525, cy=new_h * 9525)
                )
                xl_img.anchor = marker
                ws.add_image(xl_img)
                
            # Save to buffer
            out_stream = io.BytesIO()
            wb.save(out_stream)
            out_stream.seek(0)
            
            # Send response
            self.send_response(200)
            self.send_header('Content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            self.send_header('Content-Disposition', f'attachment; filename="{t_name}_FOTOS.xlsx"')
            self.end_headers()
            
            self.wfile.write(out_stream.read())
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            import json
            self.wfile.write(json.dumps({"error": str(e)}).encode())
            
