"""Reproduce bundled Organic static faces with fonttools==4.60.1.
Inputs: Inter and Outfit variable TTFs from source b7c9d78 assets/fonts.
No downloads or runtime dependencies. Usage: python script.py INTER_VF OUTFIT_VF
"""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
root = Path(__file__).resolve().parents[1]
assets = root / 'apps/mobile/assets/fonts'
native = root / 'apps/mobile/modules/balance-daily-log/android/src/main/res/font'
for source, name, weights, base in [(sys.argv[1], 'inter', [400, 500, 600, 700], 400), (sys.argv[2], 'outfit', [400, 500, 600], 500)]:
    for weight in weights:
        font = TTFont(source)
        axes = {axis.axisTag: axis.defaultValue for axis in font['fvar'].axes}
        axes['wght'] = weight
        instance = instantiateVariableFont(font, axes, inplace=False)
        suffix = {400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold'}[weight]
        target = native / (name + ('' if weight == base else '_' + suffix) + '.ttf')
        instance.save(target)
        if name == 'inter' and weight == 500:
            (assets / 'Inter-Medium.ttf').write_bytes(target.read_bytes())
        if weight == base:
            (assets / (name.title() + '.ttf')).write_bytes(target.read_bytes())
