"""Presune stazene vysledky z Downloads do cilove slozky z config.yaml.

Chrome umi stahovat jen do slozky Stazene soubory, takze konecne misto
(Plocha na OneDrive) resime az tady. Struktura podslozek se zachova.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flowbridge.config import CFG  # noqa: E402

SOURCE = Path.home() / "Downloads" / "FlowBridge"


def main() -> int:
    if not SOURCE.exists():
        print(f"Zdroj {SOURCE} neexistuje - není co přesouvat.")
        return 0

    target_root = CFG.outputs_dir
    moved = 0
    for src in sorted(SOURCE.rglob("*")):
        if not src.is_file():
            continue
        dest = target_root / src.relative_to(SOURCE)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            stem, suffix = dest.stem, dest.suffix
            n = 2
            while dest.exists():
                dest = dest.with_name(f"{stem}-{n}{suffix}")
                n += 1
        shutil.move(str(src), str(dest))
        moved += 1

    # prazdne slozky po presunu uklidime
    for d in sorted(SOURCE.rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()

    print(f"Přesunuto {moved} souborů -> {target_root}")
    for folder in sorted(p for p in target_root.rglob("*") if p.is_dir()):
        n = len([f for f in folder.iterdir() if f.is_file()])
        if n:
            print(f"  {folder.name}: {n}")
    return moved


if __name__ == "__main__":
    main()
