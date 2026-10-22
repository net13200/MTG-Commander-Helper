// A synthesized cartoon "ouch" (no audio file, so it works offline): a voice
// that yelps up and slides down through "ow" vowel formants, ending in a
// short "ch" hiss. Pitch varies a little so repeats don't sound identical.
(function (root) {
  "use strict";
  const CT = (root.CT = root.CT || {});

  function bandpass(ctx, from, to, t0, end, q) {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.linearRampToValueAtTime(to, end);
    return f;
  }

  // Builds the sound into any AudioContext (live or offline) starting at t0.
  function ouch(ctx, t0, pitch) {
    const p = pitch || 1;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);

    // "Ow": buzzy voice through two formant filters.
    const voice = ctx.createOscillator();
    voice.type = "sawtooth";
    voice.frequency.setValueAtTime(330 * p, t0);
    voice.frequency.linearRampToValueAtTime(460 * p, t0 + 0.07);
    voice.frequency.exponentialRampToValueAtTime(200 * p, t0 + 0.36);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.6, t0 + 0.03);
    env.gain.setValueAtTime(0.6, t0 + 0.22);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
    const end = t0 + 0.36;
    const f1 = bandpass(ctx, 750 * p, 420 * p, t0, end, 6);
    const f2 = bandpass(ctx, 1200 * p, 800 * p, t0, end, 8);
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;
    voice.connect(env);
    env.connect(f1).connect(out);
    env.connect(f2).connect(g2).connect(out);
    voice.start(t0);
    voice.stop(t0 + 0.4);

    // "Ch": a quick burst of filtered noise.
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2600;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    noise.connect(hp).connect(ng).connect(out);
    noise.start(t0 + 0.33);
  }

  let live = null;
  let last = 0;

  // Plays at most every 600 ms, so a burst of taps gives one or two ouches.
  function play() {
    const now = Date.now();
    if (now - last < 600) return;
    last = now;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      live = live || new AC();
      if (live.state === "suspended") live.resume();
      ouch(live, live.currentTime + 0.01, 0.9 + Math.random() * 0.25);
    } catch (e) {
      /* no audio available: stay silent */
    }
  }

  CT.Sound = { ouch, play };
})(window);
