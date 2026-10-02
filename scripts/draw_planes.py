"""Original flat aircraft with recognisable historical proportions.
Four fictional player models and three enemy liveries; all face right.
The common 400 x 200 viewBox keeps sprite centres and FX anchors predictable.
No photographs, traced artwork, fonts, or external assets are used.
"""
from pathlib import Path
from html import escape
ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'public' / 'art'
INK = '#173244'


def p(d, fill, stroke=INK, width=3.5, extra=''):
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{width}" {extra}/>'


def line(d, color, width=2.5):
    return p(d, 'none', color, width)


def roundel(x, y, accent):
    return (f'<circle cx="{x}" cy="{y}" r="9" fill="{accent}" stroke="{INK}" stroke-width="2"/>'
            f'<circle cx="{x}" cy="{y}" r="4" fill="{INK}"/>')


def hull(d, color, shade, highlight, patches=''):
    return (f'<defs><clipPath id="hull"><path d="{d}"/></clipPath></defs>'
            + p(d, color) + '<g clip-path="url(#hull)">'
            + p('M24 110Q169 110 269 118L397 118V157H24Z', shade, 'none')
            + patches + line('M91 98Q185 84 304 103', highlight, 4)
            + '</g>' + p(d, 'none'))


def mustang():
    blue, dark, light, accent = '#4b94bf', '#2a628a', '#a5cde3', '#f2d178'
    body = 'M54 102 106 94Q164 79 236 86L302 94 352 99Q363 102 364 110L358 126 301 129 231 120 112 116 55 110Z'
    return (
        p('M184 95 159 62Q157 58 164 57L194 58 247 99Z', blue)
        + p('M70 103 66 44Q66 35 77 37L122 99Z', blue)
        + p('M73 40 79 42 111 93 99 96Z', accent, 'none')
        + p('M65 99 23 119Q17 123 24 127L57 130 111 107Z', dark)
        + line('M28 122 75 106', light)
        + hull(body, blue, dark, light, p('M130 82h12v41h-12ZM155 82h12v41h-12Z', '#e5e9df', 'none'))
        + p('M243 119 281 129 259 143 230 137Z', dark)
        + p('M195 89Q198 65 215 61Q237 57 257 91Z', '#91ccdf')
        + p('M237 67 252 89 234 88 229 64Z', '#d9f5f4', 'none')
        + line('M229 63 234 90', INK, 3)
        + line('M203 71Q213 66 224 67', '#effbff', 3)
        + p('M326 96 355 100 359 117 329 118Z', accent)
        + line('M304 100h5m-5 6h5m-5 6h5m-5 6h5', INK, 3)
        + roundel(185, 102, '#eeeade')
        + p('M249 113 185 171Q181 176 176 174L132 168Q125 167 131 160L194 114Z', blue)
        + p('M133 160 178 166 183 173 133 167Z', dark, 'none')
        + line('M145 158 186 165', light)
        + p('M199 149 190 157 148 151 158 142Z', '#e5e9df', 'none')
        + p('M337 124 354 130 350 143 339 138Z', blue)
        + '<ellipse cx="373" cy="108" rx="9" ry="39" fill="#c1dce9" opacity=".18"/>'
        + p('M372 106 367 73Q367 64 373 66L378 103ZM373 110 379 144Q378 151 373 148L368 113Z', '#40556b', INK, 2.5)
        + p('M371 107 357 88 361 87 375 106ZM375 110 387 129 382 130 371 111Z', '#839aab', INK, 2)
        + p('M359 98Q375 99 381 108Q375 118 359 118Z', accent)
    )


def mig15(enemy=False):
    base, shade, light, accent = ('#bfcbd0', '#82969f', '#e7edf0', '#d9604c') if enemy else ('#69b5b4', '#398384', '#b8ded8', '#f1d18a')
    body = 'M53 101 121 91Q184 78 248 86L342 94Q361 96 366 105L366 120Q357 130 339 129L238 127 111 119 53 113Z'
    return (
        p('M176 95 126 55 152 55 242 98Z', shade)
        + p('M69 105 61 39Q62 33 76 36L123 95Z', base)
        + p('M64 45 79 49 116 93 102 96Z', accent, 'none')
        + p('M87 91 46 79 35 82 76 105 111 104Z', base)
        + p('M73 104 32 130Q27 134 37 136L75 129 122 108Z', shade)
        + p('M46 99h14v20H46Z', '#334953')
        + hull(body, base, shade, light)
        + p('M223 86Q226 63 242 59Q265 57 285 92Z', '#85c9e0')
        + p('M266 66 280 89 262 87 256 61Z', '#d7f1f4', 'none')
        + line('M254 60 262 88', INK, 3)
        + line('M232 70Q238 65 250 65', '#e4f8fa', 3)
        + p('M330 92 345 95 346 130 331 129Z', accent, 'none')
        + p('M242 113 160 172Q154 176 145 173L119 168 185 109Z', base)
        + p('M123 163 151 170 159 171 145 173 119 168Z', shade, 'none')
        + line('M142 152 159 161 209 123', light)
        + p('M192 134 180 145 147 139 158 128Z', accent, 'none')
        + roundel(147, 103, accent)
        + p('M274 122 287 134 276 141 264 127Z', shade)
        + '<ellipse cx="366" cy="112" rx="9" ry="18" fill="#c5d6df" stroke="#173244" stroke-width="3.5"/>'
        + '<ellipse cx="369" cy="112" rx="5" ry="12" fill="#293e4a"/>'
        + line('M274 114h26m-25 6h23', INK, 2.5)
        + line('M66 112 73 111', '#b0c2cb', 3)
    )


def phantom(enemy=False):
    base, shade, light, accent = ('#a9b7bf', '#6d8592', '#d9e2e7', '#db6e55') if enemy else ('#a0ab7e', '#697d62', '#d1d8ae', '#edce85')
    body = 'M49 106 104 99 153 84 213 86 275 98 320 101Q343 102 383 117Q379 126 368 127L292 132 240 129 171 121 102 126 48 121Z'
    return (
        p('M176 104 127 59 151 57 247 105Z', shade)
        + p('M62 112 58 43 81 40 130 110Z', base)
        + p('M60 45 82 46 109 85 86 83Z', accent, 'none')
        + p('M78 109 27 135 32 143 75 133 135 114Z', base)
        + p('M53 104 45 98 40 98 40 117 53 121Z', '#3b505b')
        + p('M58 112 45 112 43 130 57 132 67 119Z', '#586e78')
        + hull(body, base, shade, light, p('M107 77 141 77 188 128 156 132ZM238 81 263 85 319 144 286 140Z', '#c1c2a4' if not enemy else '#c9d1d3', 'none'))
        + p('M147 86Q155 67 173 62L193 65Q200 58 216 64L243 87 251 98 159 94Z', '#8fc5db')
        + p('M209 64 237 85 243 94 211 90Z', '#d3eced', 'none')
        + line('M192 65 201 94M209 65 215 95M164 67 176 90', INK, 3)
        + line('M164 72 181 70', '#e8f7f7', 3)
        + p('M309 102Q343 104 383 117L374 125 319 126Z', '#354956')
        + p('M270 98 302 101 282 130 254 128Z', base)
        + p('M285 102 301 103 282 128 276 126Z', '#2b414b', INK, 2.5)
        + p('M254 118 188 162 165 181 135 176 121 163 173 116Z', base)
        + p('M121 163 152 170 165 180 135 175Z', shade, 'none')
        + p('M139 147 160 137 184 162 167 175Z', accent, 'none')
        + line('M158 160 222 124', light)
        + roundel(126, 109, '#ecebd9')
        + p('M213 132 236 130 248 139 217 142Z', shade)
        + line('M302 118 319 122', '#b6c5ce', 2.5)
    )


def mig21(boss=False):
    base, shade, light, accent = ('#d9745e', '#934d48', '#f2b5a3', '#f2d083') if boss else ('#a3a8d0', '#68739d', '#d8d9ec', '#f2d88d')
    body = 'M48 104 112 96Q159 87 222 93L306 101 358 103 365 111 364 124 329 129 235 128 111 119 48 117Z'
    return (
        p('M184 98 116 64 129 60 254 103Z', shade)
        + p('M64 109 60 38 85 36 136 103Z', base)
        + p('M65 43 87 44 112 76 85 77Z', accent, 'none')
        + p('M76 107 22 135 34 143 116 113Z', base)
        + p('M42 101h16v21H42Z', '#364b57')
        + hull(body, base, shade, light)
        + p('M201 90 206 80Q216 65 235 66L269 94Z', '#8dccdf')
        + p('M238 68 263 91 244 90 230 67Z', '#d6f3f5', 'none')
        + line('M230 67 244 91', INK, 3)
        + line('M211 79 225 72', '#effbfb', 3)
        + p('M274 111 162 179Q156 186 146 181L117 171 162 114Z', base)
        + p('M120 167 150 174 161 178 146 181 117 171Z', shade, 'none')
        + line('M150 163 243 118', light)
        + p('M175 145 158 157 137 149 150 137Z', accent, 'none')
        + roundel(148, 105, accent)
        + p('M280 127 298 145 277 145 262 127Z', shade)
        + p('M332 103h15v28h-15Z', accent, 'none')
        + '<ellipse cx="362" cy="115" rx="6" ry="13" fill="#cbd7df" stroke="#173244" stroke-width="3"/>'
        + p('M360 104 388 115 360 125Z', '#354b59')
        + line('M279 115h27m-26 5h24', INK, 2.5)
    )


MODELS = [
    ('universal', 'Сокол', 'Поршневой · силуэт P-51 Mustang', mustang()),
    ('swift', 'Стриж', 'Ранний реактивный · силуэт МиГ-15', mig15()),
    ('bastion', 'Бастион', 'Тяжёлый двухмоторный · силуэт F-4 Phantom', phantom()),
    ('skate', 'Скат', 'Треугольное крыло · силуэт МиГ-21', mig21()),
    ('enemy', 'Перехватчик', 'Вражеская версия раннего реактивного', mig15(True)),
    ('enemy-heavy', 'Тяжёлый противник', 'Два двигателя и широкое крыло', phantom(True)),
    ('enemy-boss', 'Босс', 'Скоростной силуэт и красная окраска', mig21(True)),
]
for key, name, reference, layers in MODELS:
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" role="img" aria-label="{escape(name)}">'
           f'<title>{escape(name)} — {escape(reference)}</title>'
           f'<g stroke-linejoin="round" stroke-linecap="round">{layers}</g></svg>')
    (ART / f'{key}.svg').write_text(svg, encoding='utf8')

print('Updated seven legacy SVG aircraft; use models.html for review')
