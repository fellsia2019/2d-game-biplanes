"""Original 16-bar loop 'Sky Patrol'. No external samples or recordings."""
import array
import math
import random
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

RATE = 22050
BEAT = 60 / 104
LENGTH = 64 * BEAT
COUNT = round(LENGTH * RATE)
left = array.array('f', [0]) * COUNT
right = array.array('f', [0]) * COUNT
rng = random.Random(104)


def note(midi, start, duration, volume, voice='keys', pan=0):
    frequency = 440 * 2 ** ((midi - 69) / 12)
    attack = .12 if voice == 'pad' else .008
    for j in range(round(duration * RATE)):
        t = j / RATE
        if voice == 'pad':
            env = min(1, t / attack, (duration - t) / .35)
            s = (math.sin(2 * math.pi * frequency * t) + .26 * math.sin(2 * math.pi * frequency * 2.003 * t)) * env
        elif voice == 'bass':
            s = (math.sin(2 * math.pi * frequency * t) + .2 * math.sin(4 * math.pi * frequency * t)) * min(1, t / attack) * math.exp(-t * 2.5)
        else:
            s = (math.sin(2 * math.pi * frequency * t) + .32 * math.sin(4 * math.pi * frequency * t) + .09 * math.sin(6 * math.pi * frequency * t)) * min(1, t / attack) * math.exp(-t * 4)
        i = (round(start * RATE) + j) % COUNT
        left[i] += s * volume * (1 - pan * .45)
        right[i] += s * volume * (1 + pan * .45)


chords = [(45, 57, 60, 64), (41, 53, 57, 60), (48, 55, 60, 64), (43, 55, 59, 62)]
melodies = [[76, 79, 81, 79, 76, 72, 74, 76], [77, 76, 72, 69, 72, 76, 77, 79], [79, 76, 74, 72, 76, 79, 83, 81], [79, 74, 71, 74, 76, 74, 71, 72]]
for bar in range(16):
    chord = chords[bar % 4]
    start = bar * 4 * BEAT
    for k, pitch in enumerate(chord[1:]):
        note(pitch, start, 4 * BEAT + .45, .047, 'pad', (k - 1) * .65)
    for beat in range(4):
        note(chord[0], start + beat * BEAT, .7 * BEAT, .13, 'bass')
    for step in range(8):
        note(melodies[bar % 4][step], start + step * BEAT / 2, BEAT * .85, .065 if bar < 8 else .085, pan=.3 * math.sin(step))
        if bar >= 8 and step % 2 == 0:
            note(chord[1 + step % 3] + 12, start + (step + .5) * BEAT / 2, .6 * BEAT, .033, pan=-.6)
    for beat in range(4):
        at = round((start + beat * BEAT) * RATE)
        for j in range(round(.2 * RATE)):
            t = j / RATE
            kick = math.sin(2 * math.pi * (45 * t + 7 * (1 - math.exp(-t * 28)))) * math.exp(-t * 24) * .12
            snare = rng.uniform(-1, 1) * math.exp(-t * 35) * (.026 if beat % 2 else 0)
            left[(at + j) % COUNT] += kick + snare
            right[(at + j) % COUNT] += kick + snare
    for step in range(8):
        at = round((start + step * BEAT / 2) * RATE)
        for j in range(round(.055 * RATE)):
            hat = rng.uniform(-1, 1) * math.exp(-j / RATE * 90) * .009
            left[(at + j) % COUNT] += hat * .7
            right[(at + j) % COUNT] += hat

dry_left, dry_right = left[:], right[:]
for delay, gain in [(BEAT * .75, .17), (BEAT * 1.5, .09), (BEAT * 2.25, .04)]:
    offset = round(delay * RATE)
    for i in range(COUNT):
        left[i] += dry_right[(i - offset) % COUNT] * gain
        right[i] += dry_left[(i - offset) % COUNT] * gain
peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
pcm = array.array('h')
for i in range(COUNT):
    pcm.extend([round(left[i] / peak * 24500), round(right[i] / peak * 24500)])
output = Path(__file__).resolve().parents[1] / 'public' / 'audio' / 'sky-patrol.mp3'
output.parent.mkdir(parents=True, exist_ok=True)
encoder = shutil.which('ffmpeg')
if not encoder:
    raise RuntimeError('ffmpeg is required to encode the original music')
with tempfile.TemporaryDirectory(prefix='biplanes-music-') as tmp:
    wav_path = Path(tmp) / 'sky-patrol.wav'
    with wave.open(str(wav_path), 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())
    subprocess.run([encoder, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav_path), '-codec:a', 'libmp3lame', '-b:a', '96k', '-metadata', 'title=Sky Patrol', '-metadata', 'artist=Biplanes original soundtrack', str(output)], check=True)
print(f'Original music: {LENGTH:.2f}s, {output.stat().st_size // 1024} KiB')
