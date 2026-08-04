"""
Generate game SFX via ElevenLabs Sound Generation API.
Usage:
  set ELEVENLABS_API_KEY=...
  python scripts/gen_sfx_eleven.py
Does not print the API key.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'public' / 'sfx'
API = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128'

# Short, specific prompts for a cozy Township-style farm game.
# duration_seconds kept short for oneshots; rain is a loopable bed.
JOBS: list[dict] = [
  # Core gameplay (replace synths)
  {'file': 'click.mp3', 'duration': 0.55, 'influence': 0.75,
   'text': 'Tiny soft plastic UI button click, clean and short, casual mobile game interface, no music'},
  {'file': 'coin.mp3', 'duration': 0.8, 'influence': 0.7,
   'text': 'Cute bright coin pickup chime, two quick metallic pings, cheerful casual farm game, no music'},
  {'file': 'plant.mp3', 'duration': 0.75, 'influence': 0.7,
   'text': 'Soft seed planting into soil, gentle dirt pat and tiny sprout pop, cozy farming game, no music'},
  {'file': 'water.mp3', 'duration': 1.0, 'influence': 0.7,
   'text': 'Gentle watering can pour onto soil, soft water splash, cozy farm game, no music'},
  {'file': 'harvest.mp3', 'duration': 0.85, 'influence': 0.7,
   'text': 'Crisp crop harvest snip and soft vegetable pull from dirt, satisfying casual farm game, no music'},
  {'file': 'till.mp3', 'duration': 0.9, 'influence': 0.7,
   'text': 'Shovel digging soft earth thud and scrape, cozy farming game plot till, no music'},
  {'file': 'levelup.mp3', 'duration': 1.6, 'influence': 0.65,
   'text': 'Triumphant cheerful level-up jingle, rising sparkly chimes, casual mobile farm game fanfare, no voice'},
  {'file': 'rare.mp3', 'duration': 1.1, 'influence': 0.7,
   'text': 'Magical sparkle chime for rare crop find, twinkly ascending bells, casual farm game, no music bed'},
  {'file': 'epic.mp3', 'duration': 1.5, 'influence': 0.65,
   'text': 'Big magical epic discovery shimmer with deep soft thump, dazzling farm game reward, no voice'},
  {'file': 'error.mp3', 'duration': 0.7, 'influence': 0.75,
   'text': 'Soft negative UI error blip, low muted buzz, polite not harsh, casual game, no music'},
  {'file': 'pop.mp3', 'duration': 0.55, 'influence': 0.75,
   'text': 'Cute soft bubble pop collect sound, short and playful, casual farm game, no music'},
  {'file': 'hatch.mp3', 'duration': 1.1, 'influence': 0.7,
   'text': 'Cute egg crack hatch with tiny chirp and soft shell break, cozy pet farm game, no music'},
  {'file': 'whoosh.mp3', 'duration': 0.65, 'influence': 0.75,
   'text': 'Short airy whoosh swipe, light rake swing through air, casual game, no music'},
  {'file': 'squeak.mp3', 'duration': 0.7, 'influence': 0.75,
   'text': 'Cute cartoon rabbit squeak chirp, two quick indignant squeaks, farm game, no music'},
  # Gaps from audit
  {'file': 'buy.mp3', 'duration': 0.85, 'influence': 0.7,
   'text': 'Cheerful shop purchase ding and soft coin clink, casual farm game store buy, no music'},
  {'file': 'sell.mp3', 'duration': 0.95, 'influence': 0.7,
   'text': 'Satisfying coins pouring into register, sell complete jingle, cozy farm game, no music'},
  {'file': 'open.mp3', 'duration': 0.65, 'influence': 0.75,
   'text': 'Soft wooden panel open whoosh, light UI menu appear, casual farm game, no music'},
  {'file': 'dismiss.mp3', 'duration': 0.6, 'influence': 0.75,
   'text': 'Soft friendly UI confirm tap, tip dismiss acknowledgment, casual farm game, no music'},
  {'file': 'place.mp3', 'duration': 0.75, 'influence': 0.7,
   'text': 'Soft object place thud on grass, sprinkler or decor placed, cozy farm game, no music'},
  {'file': 'collect.mp3', 'duration': 0.8, 'influence': 0.7,
   'text': 'Soft animal product collect plop, egg milk wool pickup, cozy farm game, no music'},
  {'file': 'rain.mp3', 'duration': 6.0, 'influence': 0.55, 'loop': True,
   'text': 'Gentle steady light rain ambience on leaves and soil, seamless loopable bed, cozy farm, no thunder, no music'},
]


def generate(key: str, job: dict) -> bytes:
  body: dict = {
    'text': job['text'],
    'duration_seconds': job['duration'],
    'prompt_influence': job.get('influence', 0.7),
    'model_id': 'eleven_text_to_sound_v2',
  }
  if job.get('loop'):
    body['loop'] = True
  data = json.dumps(body).encode()
  req = urllib.request.Request(
    API,
    data=data,
    headers={
      'xi-api-key': key,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    method='POST',
  )
  with urllib.request.urlopen(req, timeout=120) as resp:
    return resp.read()


def main() -> int:
  key = os.environ.get('ELEVENLABS_API_KEY', '').strip()
  if not key:
    print('Missing ELEVENLABS_API_KEY', file=sys.stderr)
    return 1

  only = set(sys.argv[1:]) if len(sys.argv) > 1 else None
  OUT.mkdir(parents=True, exist_ok=True)

  ok = 0
  fail = 0
  for job in JOBS:
    name = job['file']
    if only and name not in only and Path(name).stem not in only:
      continue
    dest = OUT / name
    print(f'gen {name}…', flush=True)
    try:
      audio = generate(key, job)
      if len(audio) < 800:
        raise RuntimeError(f'too small ({len(audio)} bytes)')
      dest.write_bytes(audio)
      print(f'  wrote {dest.name} ({len(audio)} bytes)', flush=True)
      ok += 1
    except urllib.error.HTTPError as e:
      detail = e.read().decode('utf-8', errors='replace')[:300]
      print(f'  FAIL HTTP {e.code}: {detail}', flush=True)
      fail += 1
    except Exception as e:
      print(f'  FAIL {type(e).__name__}: {e}', flush=True)
      fail += 1
    time.sleep(0.35)

  print(f'done ok={ok} fail={fail}')
  return 0 if fail == 0 else 2


if __name__ == '__main__':
  raise SystemExit(main())
