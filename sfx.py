#!/usr/bin/env python3
"""Dead Ground's sounds, synthesized. Writes sfx/*.mp3 through ffmpeg. .venv/bin/python sfx.py"""
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
write('rifle', tail(shot(0.12, 900, 6000, 38, 260, 90, 40, 0.5), 0.4, 0.2))
write('hmg', tail(shot(0.16, 500, 4200, 28, 180, 60, 30, 0.9), 0.4, 0.22))
write('auto', tail(shot(0.22, 300, 3200, 20, 140, 50, 22, 1.2), 0.5, 0.25))
write('sniper', tail(shot(0.2, 1200, 7000, 30, 320, 90, 30, 0.6), 1.0, 0.35, 0.16))
write('flak', tail(mix(shot(0.12, 600, 4000, 30, 200, 70, 30, 1), np.concatenate([np.zeros(int(SR * 0.07)), shot(0.12, 600, 4000, 30, 200, 70, 30, 1)])), 0.4, 0.2))
write('cannon', tail(mix(band(noise(0.9), 120, 2500) * env(0.9, 0.001, 9), thump(0.9, 160, 38, 5) * 1.6, high(noise(0.05), 2000) * env(0.05, 0.0005, 60) * 0.6), 0.9, 0.3, 0.12))
def whoosh(d, lo, hi, k):
    t = t_(d); x = noise(d); out = np.zeros_like(x)
    # A band that slides up as the motor lights, then fades away.
    for i, (a, b) in enumerate(zip(np.linspace(lo, hi, 8)[:-1], np.linspace(lo, hi, 8)[1:])):
        seg = band(x, a, b) * np.exp(-((t - d * i / 8) ** 2) / (2 * (d / 6) ** 2)); out += seg
    return out * np.minimum(1, t * 40) * np.exp(-t * k)
write('missile', mix(whoosh(0.9, 400, 3500, 2.5), shot(0.1, 800, 5000, 40, 200, 80, 40, 0.5)))
write('rocket', mix(whoosh(0.7, 300, 2600, 3), band(noise(0.7), 2000, 6000) * env(0.7, 0.005, 6) * 0.3 * (rng.random(int(SR * 0.7)) > 0.6)))
t = t_(0.7); zap = np.sin(2 * np.pi * np.cumsum(2600 * np.exp(-t * 7) + 120) / SR)
write('rail', mix(np.sign(zap) * env(0.7, 0.001, 5) * 0.5, band(noise(0.7), 1500, 9000) * env(0.7, 0.001, 9), thump(0.7, 200, 40, 6)))
def boom(d, k, rumble, crack=0.5, f0=120, f1=30):
    return tail(mix(low(noise(d), 1400 if d < 1 else 900, 3) * env(d, 0.003, k), thump(d, f0, f1, k * 0.7) * rumble, high(noise(0.06), 1800) * env(0.06, 0.0005, 50) * crack, low(noise(d), 160, 2) * env(d, 0.01, k * 0.6) * rumble * 2), d * 0.6, 0.28, 0.14)
write('boom_s', boom(0.5, 9, 0.6, 0.6))
write('boom_m', boom(0.9, 5.5, 1.0, 0.5, 100, 28))
write('boom_l', boom(1.6, 3, 1.4, 0.4, 80, 24))
write('boom_x', boom(4.5, 0.9, 2.2, 0.3, 60, 18))
write('scream', low(noise(0.18), 500) * env(0.18, 0.004, 26))
write('click', band(noise(0.03), 2000, 6000) * env(0.03, 0.0005, 160) + np.sin(2 * np.pi * 1800 * t_(0.03)) * env(0.03, 0.0005, 120) * 0.5)
write('deny', mix(np.sign(np.sin(2 * np.pi * 220 * t_(0.09))) * 0.3, np.concatenate([np.zeros(int(SR * 0.11)), np.sign(np.sin(2 * np.pi * 170 * t_(0.12))) * 0.3])) * 0.8)
write('place', mix(thump(0.4, 140, 50, 12) * 1.2, band(noise(0.4), 300, 3000) * env(0.4, 0.002, 14), np.sin(2 * np.pi * 1250 * t_(0.4)) * env(0.4, 0.002, 18) * 0.15))
write('launch', mix(low(noise(3.2), 900, 3) * np.minimum(1, t_(3.2) * 2) * np.exp(-t_(3.2) * 0.7), whoosh(3.2, 200, 1200, 0.8), thump(3.2, 90, 30, 1.2)))
def chirp(f, d=0.09):
    return np.sin(2 * np.pi * f * t_(d)) * env(d, 0.003, 30) * 0.4
sq = band(noise(0.08), 900, 3200) * env(0.08, 0.001, 25) * 0.5
write('ack1', mix(sq, np.concatenate([np.zeros(int(SR * 0.06)), chirp(1400)])))
write('ack2', mix(sq, np.concatenate([np.zeros(int(SR * 0.05)), chirp(1100), chirp(1500)])))
def chord(notes, d, k=1.2):
    t = t_(d); x = sum(np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) for f in notes); return x * np.minimum(1, t * 30) * np.exp(-t * k)
write('won', mix(chord([196, 247, 294, 392], 2.6), thump(2.6, 90, 40, 3)))
write('lost', mix(chord([147, 175, 220, 277], 3.0, 1), thump(3, 70, 30, 2)))

# Wind over open ground, a loop that meets itself.
d = 16; w = low(noise(d), 700, 2) * (0.6 + 0.4 * np.sin(2 * np.pi * t_(d) / 8) ** 2) + band(noise(d), 1500, 3500) * 0.05
n = int(SR * 1.5); w[:n] = w[:n] * np.linspace(0, 1, n) + w[-n:] * np.linspace(1, 0, n); w = w[:-n]
write('wind', w, 0.6)

# A low score. Strings in D minor over a slow drum, thirty-two seconds that loop.
bpm = 72; beat = 60 / bpm; bars = 8; d = bars * 4 * beat; t = t_(d); music = np.zeros_like(t)
chords = [[73.4, 110, 146.8, 174.6], [58.3, 87.3, 116.5, 174.6], [65.4, 98, 130.8, 164.8], [55, 82.4, 110, 164.8]]
for i, ch in enumerate(chords):
    s0, s1 = int(i * 2 * 4 * beat * SR), int((i + 1) * 2 * 4 * beat * SR); tt = t[: s1 - s0]
    seg = sum(sum(np.sign(np.sin(2 * np.pi * f * (1 + dt) * tt)) for dt in (-0.003, 0.003)) for f in ch)
    e = np.minimum(1, tt / 1.6) * np.minimum(1, (tt[-1] - tt) / 1.6)
    music[s0:s1] += low(seg, 900, 2) * e * 0.12
for b in range(bars * 4):
    s0 = int(b * beat * SR)
    hit = thump(1.2, 110, 45, 4) * (1.0 if b % 4 == 0 else 0.45 if b % 4 == 2 else 0)
    if b % 8 == 7: hit = hit + thump(1.2, 140, 60, 6) * 0.5
    music[s0:s0 + len(hit)] += hit[: len(music) - s0] * 0.5
write('music', music, 0.75)

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
# The other ages' weapons. A bowstring's twang and the arrow's hiss.
t = t_(0.35)
write('bow', mix(np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.9, band(noise(0.35), 1200, 5000) * env(0.35, 0.02, 9) * 0.35))
# Blade on blade: a few bright, unrelated tones that ring and die, over a hard click.
t = t_(0.4)
ring = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * k) * a for f, k, a in [(2150, 14, 0.5), (3420, 18, 0.35), (5230, 24, 0.25), (1310, 10, 0.3)])
write('clash', mix(ring, high(noise(0.03), 2500) * env(0.03, 0.0005, 120) * 0.8))
# A musket: a deep, loose report with a long tail.
write('musket', tail(shot(0.3, 300, 3500, 14, 140, 45, 14, 1.4), 0.7, 0.3, 0.12))
# A catapult or trebuchet: the arm's wooden thump and the rope's rush.
write('catapult', mix(thump(0.5, 130, 50, 10) * 1.2, low(noise(0.5), 600) * env(0.5, 0.003, 12) * 0.6, whoosh(0.5, 300, 1600, 5) * 0.5))
# A pulse of light: a quick falling zap.
t = t_(0.18)
write('pulse', mix(np.sign(np.sin(2 * np.pi * np.cumsum(1800 * np.exp(-t * 14) + 380) / SR)) * env(0.18, 0.001, 18) * 0.4, band(noise(0.18), 2000, 8000) * env(0.18, 0.001, 30) * 0.3))
print('wrote', len(os.listdir('sfx')), 'sounds')
