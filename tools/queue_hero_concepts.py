"""
Queue 10 visual shock hero section concepts for slashunderscore into FlowBridge.
"""
from flowbridge import db

prompts = [
    (
        "Obsidian Monolith",
        "An ultra-premium monolithic matte black obsidian core slab hovering in absolute stillness within a dark seamless infinity studio, engineered with razor-sharp precision chamfered edges and a micro-textured satin bead-blasted finish inspired by Apple keynote industrial design and Dieter Rams minimalism. Deeply laser-etched into the obsidian face is the iconic '/_' glyph, emanating a subtle, surgical, luminescent photonic glow from within. Dramatic dual-rim edge lighting and grazing studio strobes carve the geometric silhouette out of pure velvet darkness, highlighting the crisp chamfers and microscopic stone tactile texture. High-end commercial tech product photography, shot on Hasselblad H6D-100c, 85mm lens, cinematic high-contrast lighting, Octane Render, ray-traced subsurface scattering, hyperrealistic, 8k resolution."
    ),
    (
        "Prismatic Glass",
        "Ultra-premium industrial design hero photograph of a precision-cut optical flint glass prism cube housing glowing microscopic neural circuitry and photonic wafer architecture, resting on a dark matte obsidian surface. The hyper-clear crystal refracts brilliant spectral caustic light rays and dramatic chromatic dispersion into the moody dark studio atmosphere. Deep inside the flawless glass core, a subtle laser-etched '/_' logo radiates an ethereal neon-white bioluminescent pulse, casting intricate volumetric shadows and internal reflections through the golden circuit traces. Shot on Hasselblad H6D-100c, 100mm macro lens, cinematic raytraced lighting, pristine surface reflections, extreme detail, photorealistic, 8k resolution."
    ),
    (
        "Liquid Chrome Ferrofluid",
        "Ultra-premium industrial design hero shot of a sleek brushed titanium neural compute module levitating weightlessly in mid-air against a dark studio void. Seamless liquid mirror mercury and viscous obsidian ferrofluid flow smoothly across crisp beveled geometric facets, parting through dynamic surface tension and delicate magnetic spikes to reveal an illuminated, laser-etched '/_' glyph pulsing with intense cold-white and cyan neural light. Precision studio lighting, dramatic rim lights, ray-traced liquid caustics, hyper-detailed chrome reflections, macro commercial tech photography, shallow depth of field, 8k resolution, Octane Render style."
    ),
    (
        "Kinetic AI Console",
        "Macro hero studio photograph of a bespoke minimalist kinetic AI console, engineered with an Apple meets Teenage Engineering luxury industrial design aesthetic. The monolithic chassis is crafted from aerospace-grade bead-blasted anodized space-black aluminum, featuring precision-milled chamfered edges, diamond-knurled tactile haptic dials, and microscopic acoustic perforations. Suspended weightlessly in mid-air at the center, a flawless liquid-chrome metallic orb levitates in silent electromagnetic tension, hovering millimeters above an inset dark ceramic induction plate. The induction plate emits a razor-sharp, soft-glowing illumination in the geometric form of the slashunderscore logo '/_', projecting faint chromatic caustics and subtle underglow onto the brushed metal surface. Dramatic cinematic rim lighting, crisp specular highlights, tactile micro-textures, ultra-shallow depth of field, shot on an 85mm f/1.8 macro Hasselblad lens, pristine studio black void background, 8k resolution, photorealistic."
    ),
    (
        "Brutalist Monolith",
        "Pristine commercial product photograph of a monumental brutalist monolith computing device crafted from dark graphite and matte titanium, centered inside a vast minimalist gallery of raw board-formed concrete draped in subtle drifting floor fog. An architectural one-point perspective composition where a razor-sharp, searing laser edge intensely traces and illuminates the bold physical '/_' emblem precision-milled into the monolith facade. Dramatic high-contrast chiaroscuro lighting, deep velvety shadows, razor-crisp metallic chamfers and tactile micro-textures, cinematic volumetric atmosphere, medium-format 85mm lens, 8k resolution, ultra-premium editorial tech hero."
    ),
    (
        "Synthetic Amber Neural Seed",
        "Ultra-premium commercial product photography of a futuristic AI neural seed capsule: an aerodynamic chassis of matte forged carbon fiber seamlessly encases a core of deep, translucent dark synthetic amber resin. Suspended within the flawless amber is an intricate labyrinth of glowing micro-neural fiber optics and synaptic gold filaments that converge at the center to forge a radiant, razor-sharp '/_' emblem pulsing with bioluminescent molten amber and cyan energy. Crisp macro depth of field with buttery bokeh, dramatic subsurface light scattering, mesmerizing caustics, and fine marbled composite grain, set against a clean minimalist dark industrial studio backdrop, cinematic rim lighting, hyper-detailed 8k, luxury tech editorial."
    ),
    (
        "Aerospace Carbon Gold",
        "Ultra-premium commercial hero product photography of an AI computing module, engineered with an aerospace-grade forged matte carbon fiber casing with subtle marbled textures. A surgical cutaway reveals exposed microscopic 24k gold quantum interconnects, intricate nanoscale micro-architecture, and shimmering wire-bonding. Seamlessly integrated into the chassis is an ultra-fine laser-cut ventilation grill forming the iconic '/_' emblem, illuminated by a faint, warm status backlight. Captured with an extreme macro lens with razor-sharp focal plane on the gold circuitry and smooth peripheral depth-of-field drop-off. Sculpted dual-softbox studio lighting creating delicate rim highlights along the bevelled carbon edges and rich specular reflections off the gold pathways, set against a seamless, pitch-black backdrop with balanced negative space, photorealistic, 8k."
    ),
    (
        "Holographic Lightfield Cylinder",
        "Ultra-premium commercial hero shot: A seamless cylindrical matte space-gray aluminum beacon with precision-machined chamfers rests on a polished slab of dark Nero Marquina marble. Hovering directly above its top glass aperture is a razor-sharp volumetric holographic lightfield sculpture projecting the glowing glyph '/_' (forward slash and underscore), woven from dense coherent cyan-white photonic laser filaments with subtle chromatic aberration. Minimalist Apple industrial design language, dark moody atmosphere, dramatic studio rim lighting, luminous reflections bleeding across the reflective marble surface, crisp macro focus with shallow depth of field, 8k resolution, photorealistic Hasselblad product photography."
    ),
    (
        "Cybernetic Dark Glass Core",
        "Ultra-premium tech product hero shot: a flawless dark smoked obsidian glass cube hovering in a weightless vacuum, encasing a precision laser-sliced glowing neon-white '/_' core; brilliant white luminescence radiates from the geometric slash and underscore symbol, casting intricate internal optical caustics, subtle layered reflections, and razor-sharp specular highlights across crisp chamfered glass edges; stark high contrast, minimalist architectural studio rim lighting against a pure deep void, immaculate cybernetic geometric design, hyper-detailed raytraced reflections, 8k Octane render."
    ),
    (
        "Space-Black Unibody Hub",
        "Cinematic commercial hero shot of an ultra-minimalist space-black anodized aluminum unibody supercomputer hub, embodying Apple Mac Pro and Dieter Rams Braun design heritage. The monolithic chassis features perfectly machined rounded corners, micro-bead-blasted matte metallic textures, and subterranean acoustic-thermal vents. Recessed flush into the front panel is a glowing frosted-glass emblem depicting the slash and underscore symbol '/_', radiating a clean, pure white-crystalline luminescence with soft subsurface light diffusion across the dark metal. Dramatic overhead studio top-light sculpting razor-sharp rim reflections against deep pitch-black chiaroscuro shadows. Shot on Hasselblad H6D-100c, 85mm f/2.8 lens, pristine depth of field, raytraced reflections, crisp textures, 8k resolution, ultra-premium tech aesthetic."
    )
]

def main():
    db.init()
    print("Enqueuing 10 concepts (8 images each = 80 images total)...")
    for i, (name, prompt) in enumerate(prompts, 1):
        job_id = db.add_job(
            prompt=prompt,
            kind="image",
            count=8,
            tag="hero_slashunderscore",
            aspect="16:9"
        )
        print(f"[{i}/10] Přidáno ({job_id}): {name} (8x, 16:9)")

if __name__ == "__main__":
    main()
