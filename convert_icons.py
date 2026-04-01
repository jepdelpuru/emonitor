from PIL import Image
import os

source_path = r"C:\Users\jepde\.gemini\antigravity\brain\8aacad1a-1ee8-4b37-99e7-b31fd263294e\emonitor_icon_new_1774782987556.png"
out_dir = r"y:\py\emonitor\static\icons"

if not os.path.exists(out_dir):
    os.makedirs(out_dir)

try:
    img = Image.open(source_path)
    # Ensure it's square and centered
    size = min(img.size)
    left = (img.size[0] - size) / 2
    top = (img.size[1] - size) / 2
    right = (img.size[0] + size) / 2
    bottom = (img.size[1] + size) / 2
    img = img.crop((left, top, right, bottom))
    
    # Save different sizes
    sizes = [72, 96, 128, 144, 152, 192, 384, 512]
    for s in sizes:
        resized = img.resize((s, s), Image.Resampling.LANCZOS)
        out_path = os.path.join(out_dir, f"icon-{s}x{s}.png")
        resized.save(out_path, format="PNG")
        print(f"Created {out_path}")

    # Also make a favicon
    favicon = img.resize((32, 32), Image.Resampling.LANCZOS)
    favicon.save(os.path.join(out_dir, "favicon.ico"), format="ICO")
    print("Created favicon.ico")
except Exception as e:
    print("Error:", e)
