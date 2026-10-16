const { Plugin, MarkdownRenderChild, TFolder, Keymap, Notice, Platform, setIcon } = require('obsidian');

// Each can be set by a `key: value` line in the block. Without `lat:` / `lon:`
// there is no sunrise, so the early-riser message never shows.
// `sky: off` keeps the note's own background instead of DayTime's sky; the
// emphasised words then take the colour of the hour instead.
// `dev: on` adds a corner panel with a time slider, to preview any hour.
// `reminders: off` leaves Apple Reminders out (they need remindctl, on a Mac).
const DEFAULTS = {
  name: '', folder: 'today', wake: '8:00', bed: '23:00', lat: '', lon: '',
  sky: 'on', dev: 'off', reminders: 'on',
};
const MIN = 60000;
const DAY = 24 * 60 * MIN;
let inkIds = 0;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

function parseOptions(source) {
  const opts = { ...DEFAULTS };
  for (const line of source.split('\n')) {
    const m = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
    if (m && m[1] in DEFAULTS) opts[m[1]] = m[2];
  }
  return opts;
}

// Minutes after local midnight for "H:MM".
function clockMinutes(s) {
  const [h, m = 0] = s.split(':').map(Number);
  return h * 60 + m;
}

// NOAA's approximation: local minutes after midnight of sunrise and sunset,
// or null on a polar day/night.
function sunTimes(day, lat, lon) {
  const rad = Math.PI / 180;
  const utcMidnight = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const g = (2 * Math.PI / 365) * ((utcMidnight - Date.UTC(day.getFullYear(), 0, 0)) / 864e5 - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = Math.acos(cosH) / rad;
  const local = (utcMin) => {
    const d = new Date(utcMidnight + utcMin * MIN);
    return d.getHours() * 60 + d.getMinutes();
  };
  return { rise: local(720 - 4 * (lon + ha) - eq), set: local(720 - 4 * (lon - ha) - eq) };
}

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = (c) => `rgb(${c.join(' ')})`;

// DayTime's sky colours, keyed to the real sun: dawn at sunrise, the gold hour
// before sunset, the coral at sunset, dusk and then night after it. Bedtime has
// nothing to do with it. Blended with a smoothstep, so the page drifts through
// the day like a real sky. Hours in, local time.
// [hour, sky top, sky bottom, stars, ink, glow]
// With `sky: off` the ink colours the emphasised words, and the ring runs
// from ink to glow: one colour per hour, bright enough to read on a plain note.
function sky(h, rise, set) {
  const noon = (rise + set) / 2;
  const keys = [
    [0, 0x03040c, 0x0a0e26, 1, 0x1f4fc4, 0x173a8f], // midnight: deep blue
    [rise - 1.2, 0x05071a, 0x161a40, 0.9, 0x2f62d4, 0x5a9ae6], // first light
    [rise, 0x2b2a5e, 0xe9967a, 0.25, 0xec7a6a, 0xf3a16b], // sunrise
    [rise + 1, 0x4f86c6, 0xf7d9b5, 0, 0xe89b3c, 0x5ea8e8], // morning
    [noon, 0x2a6fd1, 0xa6d8f7, 0, 0x2f86e8, 0x34c0e0], // midday
    [Math.max(set - 2.5, noon + 0.5), 0x3a5fa8, 0xf5c27a, 0, 0xe39a1f, 0xf2c14e], // golden hour
    [set, 0x2a2c66, 0xf07b5f, 0.1, 0xef6a4a, 0xd9577a], // sunset
    [set + 0.75, 0x151a40, 0x7a4f8f, 0.55, 0x3a64cc, 0xe07a8a], // dusk
    [Math.min(set + 1.75, 23.9), 0x060818, 0x151a3d, 1, 0x1f4fc4, 0x173a8f], // night
    [24, 0x03040c, 0x0a0e26, 1, 0x1f4fc4, 0x173a8f],
  ];
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= h) i++;
  const a = keys[i], b = keys[i + 1];
  let t = b[0] > a[0] ? Math.min(Math.max((h - a[0]) / (b[0] - a[0]), 0), 1) : 0;
  t = t * t * (3 - 2 * t);
  const at = (k) => mix(rgb(a[k]), rgb(b[k]), t);
  const top = at(1), bottom = at(2);
  return { top, mid: mix(top, bottom, 0.45), bottom, stars: a[3] + (b[3] - a[3]) * t, ink: at(4), glow: at(5) };
}

const pad = (n) => String(n).padStart(2, '0');
const duration = (min) => (Math.floor(min / 60) ? `${Math.floor(min / 60)}h ${min % 60}min` : `${min}min`);
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;

// A reminder's due date as a pill: the time if it is today ("16:30"), else
// "Yesterday" or the date ("Oct 14"), with the time after it when it has one.
// Reminders reports a date without a time as local midnight.
function dueLabel(iso, today) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const timed = d.getHours() || d.getMinutes();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((new Date(today).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  const overdue = days > 0 || (days === 0 && timed && d < today);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const text = days === 0 ? (timed ? time : day) : timed ? `${day} ${time}` : day;
  return { text, overdue };
}

// Apple Reminders, through remindctl (github.com/openclaw/remindctl). Obsidian
// starts without the shell's PATH, so look where Homebrew puts it.
const REMINDCTL = ['/opt/homebrew/bin/remindctl', '/usr/local/bin/remindctl'];
function remindctl(...args) {
  if (!Platform.isMacOS || !Platform.isDesktopApp) return null;
  const fs = require('fs');
  const bin = REMINDCTL.find((p) => fs.existsSync(p));
  if (!bin) return null;
  return new Promise((resolve, reject) => {
    require('child_process').execFile(bin, [...args, '--json', '--no-input'], { timeout: 15000 },
      (err, out) => (err ? reject(err) : resolve(out)));
  });
}

class HomeView extends MarkdownRenderChild {
  constructor(plugin, el, opts, sourcePath) {
    super(el);
    this.app = plugin.app;
    this.opts = opts;
    this.sourcePath = sourcePath;
    this.wake = clockMinutes(opts.wake);
    this.bed = clockMinutes(opts.bed);
  }

  onload() {
    const root = this.containerEl;
    root.addClass('home-view');
    root.dataset.sky = this.opts.sky === 'off' ? 'off' : 'on';
    // Keep clicks inside the block so Live Preview doesn't flip into source mode.
    this.registerDomEvent(root, 'mousedown', (e) => e.stopPropagation());
    this.registerDomEvent(root, 'click', (e) => e.stopPropagation());

    // Greeting on top; under it the stanza of time, date and day left, with the
    // two dials beside it (below it on a narrow pane).
    // One grid for the whole widget (see styles.css): prose left, dials and items right.
    const layout = root.createDiv('hv-layout');
    const head = layout.createDiv('hv-head');
    this.greetEl = head.createEl('p', 'hv-greeting');
    const stanza = head.createDiv('hv-stanza');
    this.nowEl = stanza.createEl('p');
    this.dateEl = stanza.createEl('p');
    this.statusEl = stanza.createEl('p');
    const dials = head.createDiv('hv-dials');
    this.buildClock(dials.createDiv({ cls: 'hv-dial hv-clock', attr: { role: 'img' } }));
    this.buildRing(dials.createDiv({ cls: 'hv-dial hv-ring', attr: { role: 'img' } }));
    this.itemsEl = layout.createDiv('hv-items');

    this.reminders = [];
    this.tick();
    this.renderItems();
    this.loadReminders();

    // Wake on each minute boundary, then every minute after it.
    const t = window.setTimeout(() => {
      this.tick();
      this.registerInterval(window.setInterval(() => this.tick(), MIN));
    }, MIN - (Date.now() % MIN) + 50);
    this.register(() => window.clearTimeout(t));
    // Catch up as soon as the page is seen again: back to the app, back to the
    // tab, or the screen woken up.
    const catchUp = () => this.tick();
    this.registerDomEvent(window, 'focus', catchUp);
    this.registerDomEvent(document, 'visibilitychange', catchUp);
    this.registerEvent(this.app.workspace.on('active-leaf-change', catchUp));
    this.registerEvent(this.app.workspace.on('layout-change', catchUp));

    const prefix = this.opts.folder.replace(/\/?$/, '/');
    const inFolder = (path) => typeof path === 'string' && path.startsWith(prefix);
    const refresh = (file, oldPath) => { if (inFolder(file.path) || inFolder(oldPath)) this.renderItems(); };
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('rename', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));

    // Reminders change in other apps, so look again whenever the page comes
    // back into view, and every five minutes.
    this.registerDomEvent(window, 'focus', () => this.loadReminders());
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) this.loadReminders(); });
    this.registerInterval(window.setInterval(() => this.loadReminders(), 5 * MIN));
  }

  // Bring the widget to the current minute. It doesn't jump there: from the
  // time it last showed it winds through the minutes in between, so after an
  // hour away the hands sweep, the numbers count and the sky shifts into place.
  // While the page can't be seen it waits, so the catch-up plays in view.
  // The dev slider asks for `instant`.
  tick(instant = false) {
    const real = new Date();
    const dev = this.pane?.hvDev;
    const target = dev?.time == null ? real
      : new Date(real.getFullYear(), real.getMonth(), real.getDate(), Math.floor(dev.time / 60), dev.time % 60);
    target.setSeconds(0, 0);
    const to = target.getTime(), from = this.shownAt;
    if (from == null || instant) return this.show(to);
    if (from === to || document.hidden || !this.containerEl.isShown()) return;
    if (Math.abs(to - from) > DAY || reducedMotion()) return this.show(to);

    // Longer gaps take a little longer, up to a second and a half.
    const ms = Math.min(350 + 220 * Math.log2(1 + Math.abs(to - from) / MIN), 1500);
    let start = null;
    const step = (t) => {
      start ??= t;
      const p = Math.min((t - start) / ms, 1);
      this.anim = p < 1 ? requestAnimationFrame(step) : 0;
      this.render(new Date(from + (to - from) * easeInOut(p)));
    };
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = requestAnimationFrame(step);
  }

  show(ms) {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = 0;
    this.render(new Date(ms));
  }

  // Draw the widget at moment `d`, which mid-animation falls between minutes.
  render(d) {
    this.shownAt = d.getTime();
    const now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / MIN;
    if (dateKey(d) !== this.day) {
      this.day = dateKey(d);
      const lat = parseFloat(this.opts.lat), lon = parseFloat(this.opts.lon);
      const sun = isNaN(lat) || isNaN(lon) ? null : sunTimes(d, lat, lon);
      this.rise = sun?.rise ?? this.wake;
      // Without a location the sky assumes a 6:30 sunrise and a 19:30 sunset.
      this.sun = sun ?? { rise: 390, set: 1170 };
      if (this.itemsEl.childElementCount) { this.renderItems(); this.loadReminders(); }
    }
    const remaining = Math.min(Math.max((this.bed - now) / (this.bed - this.wake), 0), 1);
    this.paint(now);

    const h = d.getHours();
    const part = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening';
    // The name is its own span so a narrow pane can put it on the second line.
    this.greetEl.empty();
    if (this.opts.name) {
      this.greetEl.appendText(`Good ${part}, `);
      this.greetEl.createSpan({ cls: 'hv-name', text: `${this.opts.name}.` });
    } else {
      this.greetEl.setText(`Good ${part}.`);
    }

    this.nowEl.empty();
    this.nowEl.appendText('It is now ');
    this.nowEl.createSpan({ cls: 'hv-key hv-num', text: `${pad(h)}:${pad(d.getMinutes())}` });
    this.nowEl.appendText('.');
    this.dateEl.setText(`Today is ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}.`);

    const s = this.statusEl;
    s.empty();
    const mode = now >= this.wake && now < this.bed ? 'day' : now >= this.rise && now < this.wake ? 'dawn' : 'night';
    if (mode === 'day') {
      s.appendText('You have ');
      s.createSpan({ cls: 'hv-key hv-num', text: duration(this.bed - Math.floor(now)) });
      s.appendText(' left for today.');
    } else if (mode === 'dawn') {
      s.createSpan({ cls: 'hv-key', text: 'Congratulations' });
      s.appendText(', you woke up early today.');
    } else {
      s.appendText('You should be ');
      s.createSpan({ cls: 'hv-key', text: 'sleeping' });
      s.appendText(' by now.');
    }

    this.setClock(d);
    this.setRing(mode, remaining);
  }

  // A bare analog clock: an outline, four quiet marks, two hands, a dot.
  buildClock(el) {
    const marks = [0, 90, 180, 270]
      .map((deg) => `<line class="hv-tick" x1="50" y1="9" x2="50" y2="14" transform="rotate(${deg} 50 50)"/>`)
      .join('');
    el.innerHTML = `<svg viewBox="0 0 100 100"><circle class="hv-face" cx="50" cy="50" r="46"/>${marks}`
      + '<line class="hv-hand hv-hand-h" x1="50" y1="50" x2="50" y2="29"/>'
      + '<line class="hv-hand hv-hand-m" x1="50" y1="50" x2="50" y2="15"/>'
      + '<circle class="hv-pin" cx="50" cy="50" r="2.5"/></svg>';
    this.hourHand = el.querySelector('.hv-hand-h');
    this.minuteHand = el.querySelector('.hv-hand-m');
    this.clockEl = el;
  }

  setClock(d) {
    const m = d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / MIN;
    this.hourHand.setAttribute('transform', `rotate(${(d.getHours() % 12) * 30 + m / 2} 50 50)`);
    this.minuteHand.setAttribute('transform', `rotate(${m * 6} 50 50)`);
    this.clockEl.setAttr('aria-label', `Clock showing ${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }

  // DayTime's ring: the percent of the waking day left, 100 at wake-up and 1 just
  // before bed. Before wake-up it holds DayTime's sun, after bedtime its moon.
  buildRing(el) {
    const r = 44;
    this.circumference = 2 * Math.PI * r;
    // The ring's gradient runs top (ink) to bottom (glow) on screen; the circle is turned -90°,
    // so in its own frame that is right to left. The id is per block, since
    // Live Preview can hold two copies of the block at once.
    const id = `hv-ink-${++inkIds}`;
    this.containerEl.style.setProperty('--hv-ring-ink', `url(#${id})`);
    el.innerHTML = `<svg viewBox="0 0 100 100"><defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="94" y1="50" x2="6" y2="50">`
      + '<stop offset="0" style="stop-color: var(--hv-tint)"/><stop offset="1" style="stop-color: var(--hv-glow)"/></linearGradient></defs>'
      + `<circle class="hv-ring-track" cx="50" cy="50" r="${r}"/>`
      + `<circle class="hv-ring-fill" cx="50" cy="50" r="${r}" stroke-dasharray="${this.circumference}" transform="rotate(-90 50 50)"/></svg>`;
    this.ringFill = el.querySelector('.hv-ring-fill');
    this.ringLabel = el.createDiv('hv-ring-label');
    this.ringEl = el;
  }

  setRing(mode, remaining) {
    const pct = mode === 'day' ? Math.min(Math.max(Math.ceil(remaining * 100 - 1e-9), 1), 100) : mode === 'dawn' ? 100 : 0;
    // The arc follows the exact fraction, so it drains smoothly under the whole-number label.
    const fill = mode === 'day' ? Math.max(remaining, 0.01) : mode === 'dawn' ? 1 : 0;
    this.ringFill.style.strokeDashoffset = String(this.circumference * (1 - fill));
    this.ringEl.dataset.mode = mode;
    const label = this.ringLabel;
    label.empty();
    if (mode === 'day') {
      label.createSpan({ cls: 'hv-ring-num', text: String(pct) });
      this.ringEl.setAttr('aria-label', `${pct}% of today left`);
    } else {
      setIcon(label, mode === 'dawn' ? 'sun' : 'moon');
      this.ringEl.setAttr('aria-label', mode === 'dawn' ? 'The day has not started yet' : 'Night');
    }
  }

  // The colours of the hour. With the sky on they are painted on the whole
  // pane, not just the block: the nearest .workspace-leaf-content gets them as
  // variables (styles.css draws the gradient) and a layer of stars. With the
  // sky off they colour the emphasised words and the ring instead. The dev panel
  // sits on the pane either way. Undone when the block goes away.
  paint(now) {
    const s = sky(now / 60, this.sun.rise / 60, this.sun.set / 60);
    const root = this.containerEl;
    root.style.setProperty('--hv-tint', css(s.ink));
    root.style.setProperty('--hv-glow', css(s.glow));

    const pane = root.closest('.workspace-leaf-content');
    if (!pane) {
      // Not in the document yet on the first render; try again next frame.
      if (!this.paneRetry) this.paneRetry = requestAnimationFrame(() => { this.paneRetry = 0; this.show(this.shownAt); });
      return;
    }
    // Re-applied on every paint, not just the first: while re-rendering, Live
    // Preview briefly makes a throwaway copy of the block, and when that copy
    // unloads it takes the sky down with it.
    this.pane = pane;
    pane.hvOwner = this;
    if (this.opts.dev === 'on' && !pane.querySelector(':scope > .hv-dev')) this.buildDev(pane);
    if (this.opts.sky === 'off') return;
    pane.addClass('hv-sky');
    if (!pane.querySelector(':scope > .hv-stars')) this.buildStars(pane);
    pane.style.setProperty('--hv-sky-top', css(s.top));
    pane.style.setProperty('--hv-sky-mid', css(s.mid));
    pane.style.setProperty('--hv-sky-bottom', css(s.bottom));
    pane.style.setProperty('--hv-stars', s.stars.toFixed(2));
  }

  // Dev panel: scrub the time of day. Its state lives on
  // the pane, so it survives Live Preview re-rendering the block.
  buildDev(pane) {
    pane.hvDev = pane.hvDev ?? { time: null };
    const el = pane.createDiv('hv-dev');
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    const row = (label) => {
      const r = el.createDiv('hv-dev-row');
      r.createSpan({ cls: 'hv-dev-label', text: label });
      const input = r.createEl('input', { type: 'range' });
      const value = r.createSpan('hv-dev-value');
      return { input, value };
    };
    const redraw = () => pane.hvOwner?.tick(true);

    const time = row('Time');
    time.input.min = '0'; time.input.max = '1435'; time.input.step = '5';
    const now = el.createEl('button', { cls: 'hv-dev-now', text: 'Now' });
    const showTime = () => {
      const t = pane.hvDev.time;
      const live = new Date();
      const m = t ?? live.getHours() * 60 + live.getMinutes();
      time.input.value = String(m);
      time.value.setText(t == null ? 'live' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    };
    time.input.addEventListener('input', () => { pane.hvDev.time = +time.input.value; showTime(); redraw(); });
    now.addEventListener('click', () => { pane.hvDev.time = null; showTime(); redraw(); });

    showTime();
  }

  // A fixed scatter, seeded so the stars don't jump between renders.
  buildStars(pane) {
    const el = pane.createDiv('hv-stars');
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      const star = el.createDiv('hv-star');
      star.style.left = `${rand() * 100}%`;
      star.style.top = `${rand() * 75}%`;
      star.style.setProperty('--a', (0.25 + rand() * 0.6).toFixed(2));
      star.style.setProperty('--d', `${(rand() * 5).toFixed(1)}s`);
      if (rand() > 0.88) star.addClass('is-bright');
    }
    return el;
  }

  onunload() {
    this.gone = true;
    if (this.paneRetry) cancelAnimationFrame(this.paneRetry);
    if (this.anim) cancelAnimationFrame(this.anim);
    const pane = this.pane;
    // Live Preview re-renders the block often; only the newest one cleans up.
    if (!pane || pane.hvOwner !== this) return;
    pane.removeClass('hv-sky');
    pane.querySelector(':scope > .hv-stars')?.remove();
    pane.querySelector(':scope > .hv-dev')?.remove();
    delete pane.hvDev;
    for (const k of ['--hv-sky-top', '--hv-sky-mid', '--hv-sky-bottom', '--hv-stars']) pane.style.removeProperty(k);
    delete pane.hvOwner;
  }

  files() {
    const folder = this.app.vault.getAbstractFileByPath(this.opts.folder.replace(/\/$/, ''));
    if (!(folder instanceof TFolder)) return [];
    const out = [];
    const walk = (f) => f.children.forEach((c) => (c instanceof TFolder ? walk(c) : out.push(c)));
    walk(folder);
    return out.map((file) => {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const due = fm['due date'] ?? fm.due;
      // Soonest due first; notes without a due date after them, by name.
      return { file, sortKey: String(due ?? '9999') };
    }).sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.file.basename.localeCompare(b.file.basename));
  }

  // Incomplete reminders that are overdue or due today, as in Reminders' Today
  // list, plus any just ticked that are still fading out.
  async loadReminders() {
    if (this.opts.reminders === 'off') return;
    try {
      const outs = await Promise.all([remindctl('show', 'overdue'), remindctl('show', 'today')]);
      if (outs.includes(null)) return;
      // A reminder due earlier today can be in both.
      const fetched = [...new Map(outs.flatMap((o) => JSON.parse(o)).map((r) => [r.id, r])).values()];
      const leaving = this.reminders.filter((r) => r.isCompleted && r.leave);
      this.reminders = fetched.filter((r) => !r.isCompleted && !leaving.some((x) => x.id === r.id))
        .concat(leaving)
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    } catch (err) {
      console.warn('Home View: could not read Apple Reminders', err);
      return;
    }
    if (!this.gone) this.renderItems();
  }

  // Tick or untick in Apple Reminders. The line flips at once and flips back
  // if Reminders refuses. A ticked line stays struck through for a moment, so
  // it can still be unticked, then fades out of the list.
  async toggleReminder(r) {
    this.setDone(r, !r.isCompleted);
    try {
      await remindctl('edit', r.id, r.isCompleted ? '--complete' : '--incomplete');
    } catch (err) {
      console.warn('Home View: could not update the reminder', err);
      new Notice(`Could not update "${r.title}" in Reminders.`);
      this.setDone(r, !r.isCompleted);
    }
  }

  // Flip the line where it stands rather than rebuilding the list, so the
  // box and the strike-through animate.
  setDone(r, done) {
    r.isCompleted = done;
    const li = this.itemsEl.querySelector(`[data-id="${r.id}"]`);
    li?.toggleClass('is-done', done);
    li?.setAttr('aria-checked', String(done));
    this.renderSay();
    this.scheduleLeave(r);
  }

  scheduleLeave(r) {
    window.clearTimeout(r.leave);
    if (!r.isCompleted) return;
    r.leave = window.setTimeout(() => {
      if (this.gone) return;
      const remove = () => {
        if (this.gone) return;
        this.reminders = this.reminders.filter((x) => x !== r);
        this.renderItems();
      };
      const li = this.itemsEl.querySelector(`[data-id="${r.id}"]`);
      if (!li || reducedMotion()) return remove();
      // Fade the line, then fold its height to nothing so the lines below
      // slide up instead of jumping. Height can't animate from auto, so pin
      // it to its measured size first.
      li.style.height = `${li.offsetHeight}px`;
      void li.offsetHeight;
      li.addClass('is-leaving');
      li.style.height = '0px';
      r.leave = window.setTimeout(remove, 480);
    }, 600);
  }

  renderItems() {
    const el = this.itemsEl;
    el.empty();
    const items = this.files();
    const reminders = this.reminders;
    this.sayEl = el.createEl('p', 'hv-say');
    this.renderSay(items);
    if (!items.length && !reminders.length) return;

    // A plain box per todo; clicking anywhere on the line opens the note.
    const list = el.createEl('ul', 'hv-list');
    items.forEach(({ file }) => {
      const li = list.createEl('li', { attr: { role: 'link', tabindex: '0' } });
      li.createSpan({ cls: 'hv-box', attr: { 'aria-hidden': 'true' } });
      const body = li.createSpan('hv-item');
      body.createSpan({ cls: 'hv-note', text: file.extension === 'md' ? file.basename : file.name });
      const open = (e) => this.app.workspace.openLinkText(file.path, this.sourcePath, Keymap.isModEvent(e));
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e); });
    });
    // A round box per reminder, as in Reminders; clicking the line ticks it.
    reminders.forEach((r) => {
      const li = list.createEl('li', {
        cls: r.isCompleted ? 'hv-reminder is-done' : 'hv-reminder',
        attr: { role: 'checkbox', tabindex: '0', 'aria-checked': String(!!r.isCompleted), 'data-id': r.id },
      });
      li.createSpan({ cls: 'hv-box', attr: { 'aria-hidden': 'true' } });
      const body = li.createSpan('hv-item');
      body.createSpan({ cls: 'hv-note', text: r.title });
      const due = dueLabel(r.dueDate, new Date());
      if (due) body.createSpan({ cls: due.overdue ? 'hv-due is-overdue' : 'hv-due', text: due.text });
      li.addEventListener('click', () => this.toggleReminder(r));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleReminder(r); } });
    });
  }

  // The sentence above the list. Ticking a reminder redraws only this.
  renderSay(items = this.files()) {
    const p = this.sayEl;
    p.empty();
    const reminders = this.reminders;
    const left = reminders.filter((r) => !r.isCompleted).length;
    if (!items.length && !left) {
      p.createSpan({ cls: 'hv-key', text: 'Congratulations' });
      p.appendText(', you are all clear for today.');
    } else {
      // With reminders too, each part gets its own line.
      const both = reminders.length > 0;
      p.appendText('You have');
      if (both) p.createEl('br');
      p.appendText(both ? '' : ' ');
      p.createSpan({ cls: 'hv-key hv-num', text: String(items.length) });
      p.appendText(` remaining ${plural(items.length, 'todo')}`);
      if (both) {
        p.appendText(',');
        p.createEl('br');
        p.createSpan({ cls: 'hv-key hv-num', text: String(left) });
        p.appendText(` ${plural(left, 'reminder')}`);
      }
      p.appendText('.');
    }
  }
}

module.exports = class HomeViewPlugin extends Plugin {
  onload() {
    this.registerMarkdownCodeBlockProcessor('home-view', (source, el, ctx) => {
      ctx.addChild(new HomeView(this, el, parseOptions(source), ctx.sourcePath));
    });
  }
};
