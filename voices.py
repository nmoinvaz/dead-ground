#!/usr/bin/env python3
"""The spoken calls of Mapmaker's War, rendered once with the Kokoro neural voice (Apache 2.0) into sfx/voice/*.mp3 and
listed in game.json's sounds. The game plays these in place of the browser's own voice, which sounds robotic.

    python voices.py MODEL.onnx VOICES.bin

The model and voices are kokoro-v1.0.onnx and voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx, run with a
Python that has kokoro-onnx and soundfile. Each line comes in two voices: a radio operator from the Industrial Age
on, band-limited and pressed as a field radio is, and a herald before it, slower, with a little hall. game.js finds a
clip as v_<r|h>_<the line in lower case, words joined by _>, and falls back to the browser's voice for any other."""
import json, os, re, subprocess, sys, tempfile
import soundfile as sf
from kokoro_onnx import Kokoro

# The lines game.js speaks. Radio only, herald only, and both.
RADIO = ['Construction complete', 'Unit ready', 'Low power', 'Our base is under attack', 'Ore truck under attack',
         'Insufficient supply', 'Insufficient oil', 'New technology available', 'Town captured', 'Town lost',
         'Building captured', 'Building lost', 'Missile ready', 'Warning, missile launch detected',
         'Upgrade complete']
HERALD = ['The work is done', 'At your command', 'To arms, we are attacked', 'Our carts are attacked',
          'We lack the supplies', 'New learning is ours', 'The town is ours', 'The town is lost', 'It is ours now',
          'A building has fallen', 'Our craft is bettered']
BOTH = ['The Ancient Age', 'The Medieval Age', 'The Gunpowder Age', 'The Industrial Age', 'The Modern Age',
        'The Future Age', 'Rain', 'Storm. Aircraft grounded', 'Fog', 'Snow', 'Storm warning',
        'Dust storm. Aircraft grounded', 'Dust storm warning', 'Storm passing', 'Dust storm passing', 'Bridge destroyed']

# Who speaks, how fast, and what the sound passes through.
VOICES = {
    'r': ('af_sarah', 1.0, 'highpass=f=320,lowpass=f=3300,acompressor=threshold=-20dB:ratio=5:attack=5:release=60,volume=1.6'),
    'h': ('bm_george', 0.9, 'aecho=0.8:0.55:45|80:0.22|0.12,acompressor=threshold=-18dB:ratio=3,volume=1.2'),
}


def slug(text):
    return re.sub(r'^_|_$', '', re.sub(r'[^a-z]+', '_', text.lower()))


def main():
    model, voices = sys.argv[1:3]
    k = Kokoro(model, voices)
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, 'sfx', 'voice')
    os.makedirs(out, exist_ok=True)
    made = {}
    for era, lines in (('r', RADIO + BOTH), ('h', HERALD + BOTH)):
        voice, speed, chain = VOICES[era]
        for text in lines:
            samples, rate = k.create(text + '.', voice=voice, speed=speed, lang='en-us' if voice[0] == 'a' else 'en-gb')
            name = f'v_{era}_{slug(text)}'
            with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
                sf.write(tmp.name, samples, rate)
                # A breath of silence each side, so the filter's tail is not cut.
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp.name, '-af', f'adelay=40,apad=pad_dur=0.25,{chain}',
                                '-ac', '1', '-ar', '24000', '-b:a', '48k', os.path.join(out, name + '.mp3')], check=True)
            made[name] = f'sfx/voice/{name}.mp3'
            print(name)
    # game.json's sounds: the voice clips replace any listed before, the rest stay as they are.
    gp = os.path.join(here, 'game.json')
    g = json.load(open(gp))
    g['sounds'] = {**{n: p for n, p in g['sounds'].items() if not n.startswith('v_')}, **made}
    json.dump(g, open(gp, 'w'), indent=2)
    open(gp, 'a').write('\n')


if __name__ == '__main__':
    main()
