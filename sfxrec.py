#!/usr/bin/env python3
"""Dead Ground's recorded sounds, cut from public-domain (CC0) packs into sfx/*.mp3. The packs are not kept here;
download them as sfx/SOURCES.md lists, unpack them into one folder, and run
.venv/bin/python sfxrec.py PACKS. Each take is the first event in its file, cut at its onset with its own tail,
faded out, filtered of rumble below 40 Hz and brought to the same peak as the synthesized sounds."""
import sys, subprocess, numpy as np
from scipy.signal import butter, sosfilt

SR = 32000
FIRE = 'Prepared_SFX_Library/Prepared SFX Library/'
WARS = 'qubodup-rts_warsounds_v2/qubodup-rts_warsounds_v2/'
# The game's sound, the recording, and how many seconds of it from the onset.
CUTS = {
    'rifle': (FIRE + 'AR-15/D_24P.wav', 0.55),
    'hmg': (FIRE + 'AK-47/C_31P.wav', 0.5),
    'sniper': (FIRE + '1917/B_16P.wav', 1.0),
    'musket': (FIRE + 'CD/H_16P.wav', 1.0),
    'auto': ('bangs/shot_01.ogg', 0.45),
    'flak': ('bangs/shot_03.ogg', 0.4),
    'cannon': ('cannon_fire_0.ogg', 1.3),
    'boom_s': ('bangs/bang_10.ogg', 0.7),
    'boom_m': ('bangs/bang_07.ogg', 1.1),
    'boom_l': (WARS + 'destroyer/destroyer.die.wav', 1.6),
    'rocket': (WARS + 'artil/artil.action.wav', 1.6),
    'clash': ('medieval_sfx_weapon_on_weapon_1_of_2/Sabre Norse Sword Blade on Blade.wav', 0.6),
    'bow': ('textures1/Scythian Recurve Shoot.wav', 0.8),
    'longbow': ('textures1/English Longbow Shoot.wav', 0.9),
    'xbow': ('textures1/Crossbow Shoot.wav', 0.8),
    'pulse': ('kenney-scifi/Audio/laserSmall_000.ogg', 0.5),
    'rail': ('kenney-scifi/Audio/laserLarge_000.ogg', 0.9),
}

def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

def onset(x, floor_db=-30):
    # The first point where a 5 ms envelope rises above floor_db of the file's peak after 150 ms below it.
    n = int(SR * 0.005); env = np.sqrt(np.convolve(x * x, np.ones(n) / n, mode='same')) + 1e-12
    db = 20 * np.log10(env / env.max())
    quiet = SR
    for i in range(0, len(db), n):
        if db[i] > floor_db and quiet >= int(SR * 0.15): return i
        quiet = quiet + n if db[i] < floor_db - 6 else 0
    return 0

def write(name, x, peak=0.92):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    pcm = (x * 32767).astype(np.int16).tobytes()
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-b:a', '80k', f'sfx/{name}.mp3'], input=pcm, check=True)

root = sys.argv[1]
for name, (path, secs) in CUTS.items():
    x = load(root + '/' + path)
    o = max(0, onset(x) - int(SR * 0.004))
    seg = x[o:o + int(SR * secs)].copy()
    seg = sosfilt(butter(2, 40, btype='high', fs=SR, output='sos'), seg)
    # A 3 ms fade in, and the last 40% faded out along a curve.
    fi = int(SR * 0.003); seg[:fi] *= np.linspace(0, 1, fi)
    fo = int(len(seg) * 0.4); seg[-fo:] *= np.linspace(1, 0, fo) ** 2
    write(name, seg)
    print(f'{name:<8} {path}  {len(seg) / SR:.2f}s')
