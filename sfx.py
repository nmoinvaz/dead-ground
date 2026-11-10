#!/usr/bin/env python3
"""The synthesized sounds of Mapmaker's War, into sfx/*.mp3 through ffmpeg. .venv/bin/python sfx.py. The weapons, blasts and
blades are recordings instead, cut by sfxrec.py."""
import numpy as np, subprocess, os, wave
from scipy.signal import butter, sosfilt

SR = 32000
rng = np.random.default_rng(7)
t_ = lambda d: np.arange(int(SR * d)) / SR
noise = lambda d: rng.standard_normal(int(SR * d))
def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)
def low(x, f, order=2):
    return sosfilt(butter(order, f, btype='low', fs=SR, output='sos'), x)
def high(x, f, order=2):
    return sosfilt(butter(order, f, btype='high', fs=SR, output='sos'), x)
def env(d, a=0.002, k=10):
    t = t_(d); e = np.exp(-t * k); n = max(1, int(SR * a)); e[:n] *= np.linspace(0, 1, n); return e
def thump(d, f0, f1, k):
    t = t_(d); f = f1 + (f0 - f1) * np.exp(-t * 18); ph = 2 * np.pi * np.cumsum(f) / SR; return np.sin(ph) * np.exp(-t * k)
def pad(a, d):
    out = np.zeros(int(SR * d)); out[:min(len(a), len(out))] = a[:len(out)]; return out
def mix(*xs):
    n = max(len(x) for x in xs); out = np.zeros(n)
    for x in xs: out[:len(x)] += x
    return out
def tail(x, d=0.6, gain=0.25, delay=0.09):
    # A short slap of echo off the ground and hills.
    out = pad(x, len(x) / SR + d); k = int(delay * SR)
    for i in range(1, 4):
        seg = out[k * i:k * i + len(x)]
        seg += (low(x, 2400) * gain ** i)[:len(seg)]
    return out
def write(name, x, peak=0.92):
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    tmp = f'/tmp/dg-{name}.wav'
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype(np.int16).tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-b:a', '80k', f'sfx/{name}.mp3'], check=True)
    os.remove(tmp)

shot = lambda d, lo, hi, k, f0, f1, tk, w=0.7: mix(band(noise(d), lo, hi) * env(d, 0.001, k), thump(d, f0, f1, tk) * w)
def whoosh(d, lo, hi, k):
    t = t_(d); x = noise(d); out = np.zeros_like(x)
    # A band that slides up as the motor lights, then fades away.
    for i, (a, b) in enumerate(zip(np.linspace(lo, hi, 8)[:-1], np.linspace(lo, hi, 8)[1:])):
        seg = band(x, a, b) * np.exp(-((t - d * i / 8) ** 2) / (2 * (d / 6) ** 2)); out += seg
    return out * np.minimum(1, t * 40) * np.exp(-t * k)
write('missile', mix(whoosh(0.9, 400, 3500, 2.5), shot(0.1, 800, 5000, 40, 200, 80, 40, 0.5)))
def boom(d, k, rumble, crack=0.5, f0=120, f1=30):
    return tail(mix(low(noise(d), 1400 if d < 1 else 900, 3) * env(d, 0.003, k), thump(d, f0, f1, k * 0.7) * rumble, high(noise(0.06), 1800) * env(0.06, 0.0005, 50) * crack, low(noise(d), 160, 2) * env(d, 0.01, k * 0.6) * rumble * 2), d * 0.6, 0.28, 0.14)
write('boom_x', boom(4.5, 0.9, 2.2, 0.3, 60, 18))
write('scream', low(noise(0.18), 500) * env(0.18, 0.004, 26))
write('click', band(noise(0.03), 2000, 6000) * env(0.03, 0.0005, 160) + np.sin(2 * np.pi * 1800 * t_(0.03)) * env(0.03, 0.0005, 120) * 0.5)
# A refusal: a soft two-note "nope", marimba-like, falling a fourth, quieter than the other interface sounds.
nope = lambda f: mix(np.sin(2 * np.pi * f * t_(0.16)) * env(0.16, 0.003, 26), np.sin(2 * np.pi * f * 3 * t_(0.16)) * env(0.16, 0.002, 45) * 0.25)
write('deny', mix(nope(660), np.concatenate([np.zeros(int(SR * 0.1)), nope(494)])), 0.55)
write('place', mix(thump(0.4, 140, 50, 12) * 1.2, band(noise(0.4), 300, 3000) * env(0.4, 0.002, 14), np.sin(2 * np.pi * 1250 * t_(0.4)) * env(0.4, 0.002, 18) * 0.15))
write('launch', mix(low(noise(3.2), 900, 3) * np.minimum(1, t_(3.2) * 2) * np.exp(-t_(3.2) * 0.7), whoosh(3.2, 200, 1200, 0.8), thump(3.2, 90, 30, 1.2)))
def chirp(f, d=0.09):
    return np.sin(2 * np.pi * f * t_(d)) * env(d, 0.003, 30) * 0.4
# An order heard: a soft wooden note, as a marimba's, and two rising for an attack. Its overtone dies first, so
# nothing rings high. The noise drawn here keeps every later sound's noise as it was.
noise(0.08)
def mallet(f, d=0.28):
    t = t_(d); return (np.sin(2 * np.pi * f * t) * np.exp(-t * 16) + 0.22 * np.sin(2 * np.pi * 4 * f * t) * np.exp(-t * 45)) * np.minimum(1, t / 0.003)
write('ack1', mallet(392), 0.7)
write('ack2', mix(mallet(330, 0.2), np.concatenate([np.zeros(int(SR * 0.085)), mallet(440)])), 0.7)
def chord(notes, d, k=1.2):
    t = t_(d); x = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) for f in notes); return x * np.minimum(1, t * 30) * np.exp(-t * k)
write('won', mix(chord([196, 247, 294, 392], 2.6), thump(2.6, 90, 40, 3)))
write('lost', mix(chord([147, 175, 220, 277], 3.0, 1), thump(3, 70, 30, 2)))

# Wind over open ground, a loop that meets itself.
d = 16; w = low(noise(d), 700, 2) * (0.6 + 0.4 * np.sin(2 * np.pi * t_(d) / 8) ** 2) + band(noise(d), 1500, 3500) * 0.05
n = int(SR * 1.5); w[:n] = w[:n] * np.linspace(0, 1, n) + w[-n:] * np.linspace(1, 0, n); w = w[:-n]
write('wind', w, 0.6)


# Rain on the land, a loop that meets itself: a hiss with drops in it.
d = 12; r = band(noise(d), 800, 6000) * 0.35 + low(noise(d), 500) * 0.25
drops = np.zeros(int(SR * d))
for i in rng.integers(0, len(drops) - 400, 1400): drops[i:i + 400] += high(noise(400 / SR), 2500)[:400] * np.exp(-np.arange(400) / 60) * rng.uniform(0.2, 1)
r = r + drops * 0.5
n = int(SR * 1.5); r[:n] = r[:n] * np.linspace(0, 1, n) + r[-n:] * np.linspace(1, 0, n); r = r[:-n]
write('rain', r, 0.5)
# Thunder: a crack, then a long low roll.
d = 5; t = t_(d)
crack = band(noise(0.25), 400, 4000) * env(0.25, 0.001, 18) * 0.8
roll = low(noise(d), 160, 2) * (np.minimum(1, t / 0.4) * np.exp(-t * 0.7)) * (0.7 + 0.3 * np.sin(2 * np.pi * t * 1.3))
write('thunder', mix(pad(crack, d), roll * 2.2), 0.9)
# A catapult or trebuchet: the arm's wooden thump and the rope's rush.
write('catapult', mix(thump(0.5, 130, 50, 10) * 1.2, low(noise(0.5), 600) * env(0.5, 0.003, 12) * 0.6, whoosh(0.5, 300, 1600, 5) * 0.5))
print('wrote', len(os.listdir('sfx')), 'sounds')
