"""
Generiert PNG-App-Icons und Favicon fuer IronCoach.
Laeuft mit Pillow (pip install pillow).
"""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_SIZE = 1024

# Farben
BG_TOP = (15, 15, 26)
BG_BOTTOM = (26, 26, 46)
CYAN = (0, 240, 255)
PURPLE = (124, 42, 232)
METAL_DARK = (58, 58, 92)
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return int(a + (b - a) * t)


def gradient_background(size, c1, c2):
    img = Image.new('RGB', (size, size), c1)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        r = lerp(c1[0], c2[0], t)
        g = lerp(c1[1], c2[1], t)
        b = lerp(c1[2], c2[2], t)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    return img


def create_base_icon(size=BASE_SIZE):
    # Basis mit Verlauf
    img = gradient_background(size, BG_TOP, BG_BOTTOM).convert('RGBA')

    pad = int(size * 0.03)
    corner = int(size * 0.19)

    # Weicher Leuchtrahmen
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle(
        [pad * 2, pad * 2, size - pad * 2, size - pad * 2],
        radius=corner,
        outline=(*CYAN, 90),
        width=max(2, int(size * 0.01))
    )
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.02))
    img = Image.alpha_composite(img, glow)

    # Harter Rahmen
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        [pad * 2, pad * 2, size - pad * 2, size - pad * 2],
        radius=corner,
        outline=CYAN,
        width=max(2, int(size * 0.004))
    )

    # Hantel-Ebene horizontal zeichnen, dann rotieren
    d_size = int(size * 0.72)
    dumb = Image.new('RGBA', (d_size, d_size), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dumb)

    cx, cy = d_size // 2, d_size // 2
    bar_w = int(d_size * 0.50)
    bar_h = max(14, int(d_size * 0.045))
    weight_w = max(24, int(d_size * 0.12))
    weight_h = max(64, int(d_size * 0.34))

    # Stange
    dd.rounded_rectangle(
        [cx - bar_w // 2, cy - bar_h // 2, cx + bar_w // 2, cy + bar_h // 2],
        radius=bar_h // 3,
        fill=METAL_DARK,
        outline=CYAN,
        width=max(2, int(d_size * 0.005))
    )
    # Highlight
    dd.rounded_rectangle(
        [cx - bar_w // 2 + bar_w // 12, cy - bar_h // 5,
         cx + bar_w // 2 - bar_w // 12, cy + bar_h // 5],
        radius=bar_h // 6,
        fill=(*WHITE, 45)
    )

    def draw_weight(x_off, color):
        x = cx + x_off
        dd.rounded_rectangle(
            [x - weight_w // 2, cy - weight_h // 2,
             x + weight_w // 2, cy + weight_h // 2],
            radius=weight_w // 4,
            fill=(21, 21, 40),
            outline=color,
            width=max(3, int(d_size * 0.007))
        )
        dd.rounded_rectangle(
            [x - weight_w // 3, cy - weight_h // 3,
             x + weight_w // 3, cy + weight_h // 3],
            radius=weight_w // 6,
            fill=(*color, 65)
        )
        dd.rounded_rectangle(
            [x - weight_w // 6, cy - weight_h // 6,
             x + weight_w // 6, cy + weight_h // 6],
            radius=weight_w // 10,
            fill=(*color, 130)
        )

    left_x = -bar_w // 2 - weight_w // 2 - int(d_size * 0.015)
    right_x = bar_w // 2 + weight_w // 2 + int(d_size * 0.015)
    draw_weight(left_x, CYAN)
    draw_weight(right_x, PURPLE)

    # Hantel um -45 Grad drehen und zentriert einfuegen
    dumb_rot = dumb.rotate(-45, expand=False, resample=Image.Resampling.BICUBIC)
    paste_x = (size - d_size) // 2
    paste_y = (size - d_size) // 2
    img.paste(dumb_rot, (paste_x, paste_y), dumb_rot)

    # AI-Kern / neuronale Knoten
    draw = ImageDraw.Draw(img)
    core_r = int(size * 0.045)
    draw.ellipse([size // 2 - core_r, size // 2 - core_r,
                  size // 2 + core_r, size // 2 + core_r],
                 fill=CYAN, outline=WHITE, width=max(2, size // 256))
    ring_r = int(size * 0.085)
    draw.ellipse([size // 2 - ring_r, size // 2 - ring_r,
                  size // 2 + ring_r, size // 2 + ring_r],
                 outline=CYAN, width=max(3, size // 200))

    def node(dx, dy, col):
        r = int(size * 0.028)
        x, y = size // 2 + dx, size // 2 + dy
        draw.line([(size // 2, size // 2), (x, y)], fill=col, width=max(3, size // 300))
        draw.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=WHITE, width=2)

    node(-int(size * 0.14), -int(size * 0.10), PURPLE)
    node(int(size * 0.14), int(size * 0.10), CYAN)

    return img


def save_png(src, path, size):
    src.resize((size, size), Image.Resampling.BICUBIC).save(path, 'PNG')


def main():
    base = create_base_icon(BASE_SIZE)

    sizes = {
        'favicon-16x16.png': 16,
        'favicon-32x32.png': 32,
        'apple-touch-icon.png': 180,
        'android-chrome-192x192.png': 192,
        'android-chrome-512x512.png': 512,
    }
    for filename, s in sizes.items():
        save_png(base, os.path.join(OUT_DIR, filename), s)
        print(f'Created {filename} ({s}x{s})')

    # Multi-size ICO fuer aeltere Browser
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    base.resize((256, 256), Image.Resampling.BICUBIC).save(
        os.path.join(OUT_DIR, 'favicon.ico'),
        format='ICO', sizes=ico_sizes
    )
    print('Created favicon.ico (16,32,48)')


if __name__ == '__main__':
    main()
