import json
import os

prompts_md = "# Přehled vygenerovaných Hero sekcí\n\n"

# Ideas
prompts_md += "## Hero Ideas (Tag: `hero_ideas`)\n\n"
ideas = [
    ("Abstract 3D glowing pedestal, dark sleek background, neon accents, cinematic lighting, perfect for a tech product hero section, high resolution, web design", "Abstract-3D-glowing-pedestal-dark-sleek-6nh6pzvq"),
    ("Floating glass UI cards with vibrant gradient colors on a dark background, depth of field, modern web design hero section, 3d render", "Floating-glass-UI-cards-with-vibrant-gra-1s9f1ltv"),
    ("Minimalist bright studio setup, a single geometric podium in the center, soft pastel lighting, clean aesthetic, web design hero section background", "Minimalist-bright-studio-setup-a-single-ip5y49da"),
    ("A futuristic smart home device floating in the center, surrounded by glowing data rings, dark background, cinematic lighting, tech startup hero section", "A-futuristic-smart-home-device-floating-1c3a3ang"),
    ("An explosion of colorful powder behind a sleek black smartphone, high speed photography, energetic hero section background, high contrast", "An-explosion-of-colorful-powder-behind-a-6l3lajh8"),
    ("A cozy, aesthetic coffee cup on a wooden table, soft morning sunlight, blurred background with plants, lifestyle product hero section, warm tones", "A-cozy-aesthetic-coffee-cup-on-a-wooden-4f6clgpp"),
    ("Abstract flowing silk fabric in deep blue and purple tones, luxurious aesthetic, soft lighting, elegant web design hero section", "Abstract-flowing-silk-fabric-in-deep-blu-42ylmqua"),
    ("A sleek pair of wireless headphones resting on a minimalist concrete block, moody lighting, modern product photography, hero section", "A-sleek-pair-of-wireless-headphones-rest-t4zzz9g3"),
    ("Futuristic cyberpunk city skyline at night viewed from a high balcony, neon lights, rainy, atmospheric hero section background", "Futuristic-cyberpunk-city-skyline-at-nig-r5drh0m2"),
    ("A clean, modern workspace desk with a laptop, plant, and notebook, top-down view, bright lighting, productivity app hero section", "A-clean-modern-workspace-desk-with-a-lap-b8df1rme")
]
for prompt, folder in ideas:
    prompts_md += f"### {folder}\n"
    prompts_md += f"- **Prompt:** `{prompt}`\n"
    prompts_md += f"- **Složka:** `hero_ideas/{folder}`\n\n"

# Logos
prompts_md += "## Slashunderscore Logo (Tag: `hero_logo`)\n\n"
logos = [
    ("A large glowing slash and underscore symbol /_ floating in a dark, atmospheric tech environment, neon lights, cinematic, modern developer tool hero section", "A-large-glowing-slash-and-underscore-sym-w98ktb4k"),
    ("The symbol /_ made of glowing neon glass, floating over a futuristic city, cyberpunk aesthetic, web design hero background", "The-symbol-made-of-glowing-neon-glass-fl-extr17i6"),
    ("A sleek, minimalist metallic sculpture of the characters /_ on a clean white pedestal, soft studio lighting, elegant hero section", "A-sleek-minimalist-metallic-sculpture-of-guaaw4es")
]
for prompt, folder in logos:
    prompts_md += f"### {folder}\n"
    prompts_md += f"- **Prompt:** `{prompt}`\n"
    prompts_md += f"- **Složka:** `hero_logo/{folder}`\n\n"

with open("outputs/vybrané/prompty.md", "w", encoding="utf-8") as f:
    f.write(prompts_md)
