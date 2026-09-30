import { bind, play, setVolume } from '@bloxwap/sfx';

// 1. Wire every data-sound-* attribute, now and later.
//    <button data-sound-press data-sound-release>Save</button>
const unbind = bind();

// 2. Or play a sound directly.
async function save() {
  try {
    await fetch('/api/save', { method: 'POST' });
    play('success');
  } catch {
    play('error');
  }
}

// 3. Mix it into your product.
setVolume(0.6);
