import zipfile
import os
import shutil

def aggressive_strip_drawings(filepath):
    temp_dir = "temp_unzip"
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    
    with zipfile.ZipFile(filepath, 'r') as zip_ref:
        zip_ref.extractall(temp_dir)
    
    # Remove drawing files
    drawings_dir = os.path.join(temp_dir, "xl", "drawings")
    if os.path.exists(drawings_dir):
        shutil.rmtree(drawings_dir)
        
    # Remove drawing references from worksheets
    rels_dir = os.path.join(temp_dir, "xl", "worksheets", "_rels")
    if os.path.exists(rels_dir):
        for f in os.listdir(rels_dir):
            if f.endswith(".rels"):
                rels_path = os.path.join(rels_dir, f)
                with open(rels_path, 'r', encoding='utf-8') as file:
                    content = file.read()
                # Remove Relationship elements that point to drawings
                import re
                content = re.sub(r'<Relationship Id="[^"]+" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/[^"]+"/>', '', content)
                with open(rels_path, 'w', encoding='utf-8') as file:
                    file.write(content)
                    
    # Re-zip
    new_filepath = filepath + ".clean.xlsx"
    with zipfile.ZipFile(new_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(temp_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, temp_dir)
                zipf.write(file_path, arcname)
                
    shutil.rmtree(temp_dir)
    shutil.move(new_filepath, filepath)
    print(f"Aggressively stripped {filepath}")

aggressive_strip_drawings(os.path.join("LISTAS DE BUENA FE AFA SOMOS TODOS 2026", "TEST.xlsx"))
