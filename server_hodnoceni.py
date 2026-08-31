import os
import json
import re
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import uvicorn

app = FastAPI()

# Mount the static directory to serve images
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

class Rating(BaseModel):
    folder: str
    prompt: str
    rating: int
    notes: str

def parse_prompty_md():
    md_path = "outputs/vybrané/prompty.md"
    if not os.path.exists(md_path):
        return []
    
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        
    items = []
    current_folder = None
    current_prompt = None
    
    for line in lines:
        line = line.strip()
        if line.startswith("### "):
            current_folder = line[4:].strip()
        elif line.startswith("- **Prompt:**"):
            current_prompt = line.replace("- **Prompt:** `", "").replace("`", "")
        elif line.startswith("- **Složka:**"):
            folder_path = line.replace("- **Složka:** `", "").replace("`", "")
            
            # Find images in this folder
            full_dir = os.path.join("outputs", "vybrané", folder_path)
            images = []
            if os.path.exists(full_dir):
                images = [f for f in os.listdir(full_dir) if f.endswith(".png") or f.endswith(".jpg")]
                images = [f"/outputs/vybrané/{folder_path}/{img}" for img in images]
            
            if current_prompt and folder_path:
                items.append({
                    "folder": folder_path,
                    "prompt": current_prompt,
                    "images": images
                })
    return items

@app.get("/", response_class=HTMLResponse)
async def get_ui():
    items = parse_prompty_md()
    
    # Load existing ratings
    ratings = {}
    if os.path.exists("ratings.json"):
        with open("ratings.json", "r", encoding="utf-8") as f:
            try:
                ratings_list = json.load(f)
                for r in ratings_list:
                    ratings[r["folder"]] = r
            except:
                pass
                
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Hodnocení Promptů</title>
        <style>
            body { font-family: sans-serif; margin: 20px; background: #f5f5f5; }
            .item { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .prompt { font-size: 1.2em; font-weight: bold; margin-bottom: 15px; padding: 10px; background: #eef; border-left: 4px solid #66f; }
            .images { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 15px; }
            .images img { max-width: 300px; height: auto; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
            .rating-form { display: flex; flex-direction: column; gap: 10px; max-width: 500px; }
            textarea { height: 80px; padding: 8px; }
            button { padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; }
            button:hover { background: #45a049; }
            .status { color: green; font-weight: bold; display: none; }
        </style>
    </head>
    <body>
        <h1>Hodnocení Výsledků</h1>
        <p>Prohlédni si obrázky, ohodnoť výsledek (1-5) a případně přidej poznámku. Jakmile budeš hotov, řekni mi to v chatu a já napíšu guide.</p>
        <div id="items">
    """
    
    for item in items:
        folder = item["folder"]
        existing = ratings.get(folder, {"rating": 0, "notes": ""})
        
        imgs_html = "".join([f'<img src="{img}" />' for img in item["images"]])
        
        html += f"""
        <div class="item">
            <div class="prompt">{item["prompt"]}</div>
            <div class="images">{imgs_html}</div>
            <div class="rating-form" data-folder="{folder}" data-prompt="{item["prompt"]}">
                <label>Hodnocení (1-5 hvězdiček):</label>
                <input type="number" class="rating-input" min="1" max="5" value="{existing["rating"] or ''}">
                <label>Co je na tomto výsledku dobré/špatné?</label>
                <textarea class="notes-input">{existing["notes"]}</textarea>
                <button onclick="saveRating(this)">Uložit hodnocení</button>
                <span class="status">Uloženo!</span>
            </div>
        </div>
        """
        
    html += """
        </div>
        <script>
            async function saveRating(btn) {
                const form = btn.parentElement;
                const folder = form.getAttribute('data-folder');
                const prompt = form.getAttribute('data-prompt');
                const rating = parseInt(form.querySelector('.rating-input').value) || 0;
                const notes = form.querySelector('.notes-input').value;
                
                const response = await fetch('/rate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({folder, prompt, rating, notes})
                });
                
                if (response.ok) {
                    const status = form.querySelector('.status');
                    status.style.display = 'inline';
                    setTimeout(() => status.style.display = 'none', 2000);
                }
            }
        </script>
    </body>
    </html>
    """
    return html

@app.post("/rate")
async def rate_prompt(rating: Rating):
    ratings = []
    if os.path.exists("ratings.json"):
        with open("ratings.json", "r", encoding="utf-8") as f:
            try:
                ratings = json.load(f)
            except:
                pass
                
    # Update or add
    found = False
    for i, r in enumerate(ratings):
        if r["folder"] == rating.folder:
            ratings[i] = rating.dict()
            found = True
            break
            
    if not found:
        ratings.append(rating.dict())
        
    with open("ratings.json", "w", encoding="utf-8") as f:
        json.dump(ratings, f, indent=2, ensure_ascii=False)
        
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
