/*
 * CLOCKIT — sound & haptics
 * ---------------------------------------------------------------
 * All sounds are generated live with the Web Audio API, so the app
 * needs no audio files. Browsers only allow sound after the user has
 * touched the page, so the first tap "unlocks" audio.
 *
 * Note: on iPhone, the silent switch also silences web audio.
 */
(function (root) {
  'use strict';

  var ctx = null;
  var master = null;
  var enabled = true;

  function ensureContext() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  /* Call from inside a tap/click handler. Safe to call repeatedly. */
  function unlock() {
    var c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended' && c.resume) { c.resume().catch(function () {}); }
    // A silent blip satisfies older iOS versions.
    try {
      var b = c.createBuffer(1, 1, 22050);
      var s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
    } catch (e) { /* ignore */ }
  }

  /*
   * One synthesised note.
   *   freq: start pitch in Hz      to: optional end pitch (glide)
   *   dur: seconds                 at: delay in seconds
   *   type: oscillator shape       vol: peak volume 0–1
   */
  function tone(o) {
    if (!enabled) return;
    var c = ensureContext();
    if (!c || c.state !== 'running') return;
    var t0 = c.currentTime + (o.at || 0);
    var dur = o.dur || 0.1;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    var vol = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  /* Short burst of filtered noise — gives the switch a mechanical "clack". */
  function noise(o) {
    if (!enabled) return;
    var c = ensureContext();
    if (!c || c.state !== 'running') return;
    var t0 = c.currentTime + (o.at || 0);
    var len = Math.floor(c.sampleRate * (o.dur || 0.03));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    var src = c.createBufferSource();
    src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = o.freq || 2400; f.Q.value = 1.4;
    var g = c.createGain(); g.gain.value = o.vol == null ? 0.5 : o.vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  var Sound = {
    unlock: unlock,
    setEnabled: function (on) { enabled = !!on; if (on) unlock(); },
    isEnabled: function () { return enabled; },

    /* Turn handover: a crisp clack, pitched per side. */
    switchTurn: function (toPlayer) {
      noise({ freq: toPlayer === 0 ? 2600 : 2100, dur: 0.035, vol: 0.55 });
      tone({ freq: toPlayer === 0 ? 180 : 150, to: 90, dur: 0.09, type: 'sine', vol: 0.35 });
    },
    start: function () {
      tone({ freq: 440, dur: 0.09, type: 'triangle', vol: 0.22 });
      tone({ freq: 660, dur: 0.09, type: 'triangle', vol: 0.22, at: 0.09 });
      tone({ freq: 880, dur: 0.22, type: 'triangle', vol: 0.26, at: 0.18 });
    },
    pause: function () {
      tone({ freq: 620, dur: 0.1, type: 'triangle', vol: 0.18 });
      tone({ freq: 420, dur: 0.16, type: 'triangle', vol: 0.18, at: 0.1 });
    },
    resume: function () {
      tone({ freq: 420, dur: 0.08, type: 'triangle', vol: 0.18 });
      tone({ freq: 620, dur: 0.14, type: 'triangle', vol: 0.2, at: 0.08 });
    },
    addTime: function () {
      tone({ freq: 1320, dur: 0.08, type: 'sine', vol: 0.22 });
      tone({ freq: 1760, dur: 0.16, type: 'sine', vol: 0.22, at: 0.07 });
    },
    nudge: function () {
      tone({ freq: 160, dur: 0.12, type: 'square', vol: 0.08 });
    },
    /* Final tone when a flag falls. */
    timeout: function () {
      tone({ freq: 880, dur: 0.18, type: 'square', vol: 0.12 });
      tone({ freq: 660, dur: 0.18, type: 'square', vol: 0.12, at: 0.2 });
      tone({ freq: 440, dur: 0.6, type: 'square', vol: 0.12, at: 0.4 });
    },
    /* Victory fanfare. delay in seconds (default 0.9, after the timeout tone). */
    fanfare: function (delay) {
      var d = delay == null ? 0.9 : delay;
      var notes = [523, 659, 784, 1047, 784, 1047];
      var times = [0, 0.12, 0.24, 0.36, 0.56, 0.68];
      for (var i = 0; i < notes.length; i++) {
        tone({ freq: notes[i], dur: i === notes.length - 1 ? 0.5 : 0.13, type: 'square', vol: 0.1, at: d + times[i] });
      }
    },
    /* Soft clock tick (Showtime, once a second). */
    tick: function () {
      tone({ freq: 1900, dur: 0.022, type: 'square', vol: 0.05 });
    },
    /* Countdown beep. final = the zero beep. */
    beep: function (final) {
      tone({ freq: final ? 1320 : 880, dur: final ? 0.45 : 0.11, type: 'sine', vol: 0.32 });
    },
    /* Game-show buzzer for "time's up". */
    buzzer: function () {
      tone({ freq: 104, dur: 0.95, type: 'sawtooth', vol: 0.2 });
      tone({ freq: 110, dur: 0.95, type: 'sawtooth', vol: 0.2 });
      tone({ freq: 220, dur: 0.95, type: 'square', vol: 0.07 });
    },
    /* Bright double bell: work starts. */
    bellHigh: function () {
      tone({ freq: 1046, dur: 0.7, type: 'sine', vol: 0.3 });
      tone({ freq: 1568, dur: 0.6, type: 'sine', vol: 0.16 });
      tone({ freq: 1046, dur: 0.7, type: 'sine', vol: 0.26, at: 0.18 });
    },
    /* Calm low bell: rest starts. */
    bellLow: function () {
      tone({ freq: 523, dur: 0.8, type: 'sine', vol: 0.3 });
      tone({ freq: 784, dur: 0.6, type: 'sine', vol: 0.12 });
    },
    /* Turn hand-over in Group mode, pitched per player. */
    chime: function (player) {
      var scale = [523, 587, 659, 784, 880, 1047, 1175, 1319];
      var f = scale[(player || 0) % scale.length];
      noise({ freq: 2400, dur: 0.03, vol: 0.35 });
      tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.22, at: 0.01 });
    },
    /* Lap split click. */
    lap: function () {
      noise({ freq: 3200, dur: 0.025, vol: 0.4 });
      tone({ freq: 1500, dur: 0.06, type: 'triangle', vol: 0.16 });
    },
    /* Chaos: heartbeat for Panic Mode. intensity 0–1. */
    heartbeat: function (intensity) {
      var v = 0.25 + 0.35 * (intensity || 0);
      tone({ freq: 70, to: 45, dur: 0.12, type: 'sine', vol: v });
      tone({ freq: 70, to: 45, dur: 0.14, type: 'sine', vol: v * 0.8, at: 0.16 });
      if (intensity > 0.6) tone({ freq: 1200, dur: 0.05, type: 'square', vol: 0.05, at: 0.02 });
    },
    /* Chaos: arcade handover blip. */
    arcade: function (combo) {
      var base = 440 + Math.min(combo || 0, 8) * 40;
      tone({ freq: base, dur: 0.06, type: 'square', vol: 0.09 });
      tone({ freq: base * 1.5, dur: 0.06, type: 'square', vol: 0.09, at: 0.06 });
      tone({ freq: base * 2, dur: 0.1, type: 'square', vol: 0.09, at: 0.12 });
    },
    /* Chaos: drum roll / horn sting for Dramatic announcements. */
    sting: function () {
      tone({ freq: 196, dur: 0.5, type: 'sawtooth', vol: 0.07 });
      tone({ freq: 247, dur: 0.5, type: 'sawtooth', vol: 0.06, at: 0.02 });
      tone({ freq: 294, dur: 0.6, type: 'sawtooth', vol: 0.06, at: 0.04 });
    }
  };

  /*
   * Haptics
   * Android browsers support navigator.vibrate. iPhone Safari does not,
   * but iOS 18+ gives a light system tap when a "switch" checkbox is
   * toggled — we toggle an invisible one. Needs real-device testing.
   */
  var hapticsOn = true;
  var switchLabel = null;

  function initHaptics() {
    if (switchLabel || typeof document === 'undefined') return;
    var label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    switchLabel = label;
  }

  var Haptics = {
    init: initHaptics,
    setEnabled: function (on) { hapticsOn = !!on; },
    /* Call from inside a tap handler. */
    tap: function (strong) {
      if (!hapticsOn) return;
      try {
        if (navigator.vibrate) { navigator.vibrate(strong ? [18, 40, 18] : 14); return; }
        if (switchLabel) switchLabel.click();
      } catch (e) { /* ignore */ }
    }
  };

  root.DuelSound = Sound;
  root.DuelHaptics = Haptics;
})(typeof self !== 'undefined' ? self : this);
