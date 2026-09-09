import os
import sys

def create_scroll_animation(video_path, output_dir="hero_animation"):
    try:
        import cv2
    except ImportError:
        print("Chyba: Knihovna 'opencv-python' není nainstalována.")
        print("Nainstaluj ji pomocí: pip install opencv-python")
        sys.exit(1)

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    frames_dir = os.path.join(output_dir, "frames")
    if not os.path.exists(frames_dir):
        os.makedirs(frames_dir)

    print(f"Otevírám video {video_path}...")
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        print(f"Chyba: Nepodařilo se otevřít video '{video_path}'. Zkontroluj cestu k souboru.")
        sys.exit(1)

    print(f"Extrahuji snímky do {frames_dir}...")
    
    frame_count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        frame_count += 1
        
        # Zmenšení pro web, zachování poměru stran (šířka max 1920)
        height, width = frame.shape[:2]
        if width > 1920:
            scale = 1920 / width
            frame = cv2.resize(frame, (1920, int(height * scale)), interpolation=cv2.INTER_AREA)

        out_path = os.path.join(frames_dir, f"frame_{frame_count:04d}.jpg")
        # Uložíme jako JPG s kvalitou 85 (dobrý kompromis pro web)
        cv2.imwrite(out_path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        
        if frame_count % 30 == 0:
            print(f"Zpracováno {frame_count} snímků...")

    cap.release()
    
    if frame_count == 0:
        print("Chyba: Žádné snímky nebyly vygenerovány (video je prázdné nebo nečitelné).")
        sys.exit(1)
        
    print(f"Dokončeno! Celkem vygenerováno {frame_count} snímků.")

    # HTML kód pro scrollovací animaci (tzv. Apple scroll style)
    html_content = f"""<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Scroll Animated Hero</title>
    <style>
        body {{
            margin: 0;
            background: #000;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            /* Zvětšíme výšku stránky, abychom měli prostor pro scrollování videa */
            height: 400vh; 
        }}
        
        #hero-container {{
            position: sticky;
            top: 0;
            width: 100%;
            height: 100vh;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        
        canvas {{
            width: 100%;
            height: 100%;
            object-fit: cover;
            position: absolute;
            top: 0;
            left: 0;
            z-index: 1;
        }}

        .content {{
            position: relative;
            z-index: 2;
            text-align: center;
            /* Text se objeví až na úplném konci scrollování */
            opacity: 0;
            transition: opacity 0.5s ease, transform 0.5s ease;
            transform: translateY(30px);
        }}

        .content.visible {{
            opacity: 1;
            transform: translateY(0);
        }}

        .content h1 {{
            font-size: 5rem;
            margin-bottom: 10px;
            text-shadow: 0 4px 20px rgba(0,0,0,0.9);
        }}

        .content p {{
            font-size: 1.5rem;
            text-shadow: 0 2px 10px rgba(0,0,0,0.9);
            color: #ddd;
        }}
        
        .content button {{
            margin-top: 30px;
            padding: 15px 30px;
            font-size: 1.2rem;
            border-radius: 30px;
            border: none;
            background: white;
            color: black;
            font-weight: bold;
            cursor: pointer;
        }}
    </style>
</head>
<body>

    <div id="hero-container">
        <!-- Zde se budou kreslit obrázky z videa -->
        <canvas id="hero-canvas"></canvas>
        
        <!-- Text, který překryje finální snímek -->
        <div class="content" id="hero-content">
            <h1>Budoucnost webu</h1>
            <p>Plynulé animace a strhující design na první dobrou.</p>
            <button>Začít nyní</button>
        </div>
    </div>
    
    <!-- Volitelný další obsah webu (abychom viděli, co následuje po hero sekci) -->
    <div style="height: 100vh; background: #111; display: flex; align-items: center; justify-content: center; position: relative; z-index: 3;">
        <h2>Zde pokračuje zbytek stránky...</h2>
    </div>

    <script>
        const canvas = document.getElementById("hero-canvas");
        const context = canvas.getContext("2d");
        const frameCount = {frame_count};
        
        // Získá URL obrázku podle indexu (od 0001 po XXXX)
        const currentFrame = index => (
            `frames/frame_${{index.toString().padStart(4, '0')}}.jpg`
        );

        // Nastavení plátna pro Full HD rozlišení
        canvas.width = 1920;
        canvas.height = 1080;

        // Vykreslení prvního snímku hned po načtení
        const img = new Image();
        img.src = currentFrame(1);
        img.onload = function() {{
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
        }}

        const updateImage = index => {{
            img.src = currentFrame(index);
            context.drawImage(img, 0, 0, canvas.width, canvas.height);
        }}

        // Přednačtení (preload) všech obrázků pro plynulé scrollování
        const preloadImages = () => {{
            for (let i = 1; i <= frameCount; i++) {{
                const imgPreload = new Image();
                imgPreload.src = currentFrame(i);
            }}
        }};
        preloadImages();

        // Hlavní logika scrollování
        window.addEventListener('scroll', () => {{  
            const scrollTop = document.documentElement.scrollTop;
            // Spočítáme rolovatelnou vzdálenost v hero sekci (celá výška stránky mínus 2x viewport, aby zbytek šel rolovat)
            const heroScrollDistance = (document.body.scrollHeight - window.innerHeight * 2);
            
            // Pojistka proti zápornému scrollu
            const validScrollTop = Math.max(0, scrollTop);
            
            // Poměr scrollování (0.0 až 1.0) v rámci naší vyhrazené délky
            let scrollFraction = validScrollTop / heroScrollDistance;
            if (scrollFraction > 1) scrollFraction = 1; // Zastavit animaci videa na konci
            
            // Vypočte přesný index obrázku
            const frameIndex = Math.min(
                frameCount,
                Math.ceil(scrollFraction * frameCount)
            );
            
            const frameToRender = frameIndex === 0 ? 1 : frameIndex;
            requestAnimationFrame(() => updateImage(frameToRender));

            // Zobrazí a schová HTML text
            const content = document.getElementById('hero-content');
            if (scrollFraction > 0.85) {{
                // Posledních 15% videa se ukáže nadpis
                content.classList.add('visible');
            }} else {{
                content.classList.remove('visible');
            }}
        }});
    </script>
</body>
</html>
"""
    html_path = os.path.join(output_dir, "index.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
        
    print(f"Hotovo! Rozsekané video a webová stránka jsou složce: '{output_dir}'.")
    print(f"Pro zkoušku otevři soubor '{html_path}' v prohlížeči.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Použití: python make_scroll_video.py <cesta_k_videu.mp4> [cilova_slozka]")
        sys.exit(1)
        
    video_file = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "hero_animation"
    
    create_scroll_animation(video_file, out_dir)
