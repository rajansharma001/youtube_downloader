import os
from PIL import Image, ImageDraw

def create_icon(size: int, output_path: str):
    # Create canvas with transparency
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded rectangle background with modern orange-to-coral gradient
    margin = int(size * 0.05)
    radius = int(size * 0.28)
    
    # Draw rounded rectangle background (StreamGrab signature orange)
    # Background color: #ff6422
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=radius,
        fill=(255, 100, 34, 255)
    )

    # Draw download arrow and music note indicator
    cx, cy = size // 2, size // 2
    arrow_w = max(2, int(size * 0.18))
    arrow_h = int(size * 0.28)
    top_y = int(size * 0.24)
    tip_y = int(size * 0.58)

    # Arrow stem
    stem_half = max(1, int(size * 0.07))
    draw.rectangle(
        [cx - stem_half, top_y, cx + stem_half, tip_y - int(size * 0.08)],
        fill=(255, 255, 255, 255)
    )

    # Arrow head (triangle)
    head_w = int(size * 0.24)
    draw.polygon(
        [
            (cx - head_w, tip_y - int(size * 0.1)),
            (cx + head_w, tip_y - int(size * 0.1)),
            (cx, tip_y + int(size * 0.08))
        ],
        fill=(255, 255, 255, 255)
    )

    # Base tray / dish line
    tray_y = int(size * 0.74)
    tray_w = int(size * 0.3)
    tray_thick = max(1, int(size * 0.07))
    draw.line(
        [(cx - tray_w, tray_y), (cx + tray_w, tray_y)],
        fill=(255, 255, 255, 255),
        width=tray_thick
    )

    img.save(output_path, "PNG")
    print(f"Generated: {output_path} ({size}x{size})")

out_dir = os.path.dirname(os.path.abspath(__file__))
icons_dir = os.path.join(out_dir, "icons")
os.makedirs(icons_dir, exist_ok=True)

for s in [16, 48, 128]:
    p = os.path.join(icons_dir, f"icon{s}.png")
    create_icon(s, p)
