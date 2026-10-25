# ClockIt

**Every way to keep time at the table.** Four timers in one installable web app, built for game nights, quizzes and face-to-face games. Put the phone on the table and play.

| Mode | What it's for |
|---|---|
| **Duel** | Chess-style clock for two players. Tap your side to end your turn. |
| **Group** | Turn timer for 2–8 players: a limit per turn, or a time bank per player. |
| **Showtime** | Big, graphic countdown for quizzes and game shows, with buzzer and stage view. |
| **Stopwatch** | Hundredths, laps, fastest/slowest, and a pace ring against your best lap. |

Tap the logo and mode name in the top-left corner to switch modes. The first visit opens the mode picker.

Plain HTML, CSS and JavaScript with **no build step, no dependencies, no accounts and no server**. It works offline once it has loaded once from a website.

---

## Project structure

```
clockit/
├── index.html              All screens: header, the four modes, settings, mode picker
├── styles.css              All visuals. Themes are colour tokens at the top of the file
├── js/
│   ├── engine.js           Duel timer logic (single source of truth for Duel)
│   ├── timers.js           Logic for Stopwatch, Showtime and Group
│   ├── shell.js            Mode picker, status chip, screen wake lock, keyboard routing
│   ├── app.js              Duel screen + shared settings, sound toggle, offline support
│   ├── group.js            Group mode screen
│   ├── showtime.js         Showtime mode screen
│   ├── stopwatch.js        Stopwatch mode screen
│   ├── sound.js            Sounds made live with Web Audio (no audio files) + haptics
│   └── chaos.js            Duel's Chaos Mode lines. Edit freely
├── sw.js                   Service worker: offline caching. Bump VERSION on every release
├── manifest.webmanifest    Name, colours and icons for "Add to Home Screen"
├── icons/                  App icons
├── tests/                  30 automated tests for all the timer logic
├── package.json            Only used to run the tests (no packages to install)
└── .nojekyll               Tells GitHub Pages to serve files exactly as they are
```

## The modes in detail

**Duel**: presets from Bullet (1 min) to Marathon (15 min) plus Custom; bonus per move; Table mode flips Player 1's side to face across the table; victory screen split for both players; optional Chaos Mode (Dramatic, Roast Battle, Panic Mode, Couch Champion).

**Group**
- 2–8 named players, each with their own colour.
- *Turn limit* (15 s to 5 min, resets every turn) or *Time bank* (3 to 60 min each for the whole game).
- The big card shows whose turn it is. Tap it to pass to the next player. Tap any player tile to give them the turn out of order.
- **Undo** hands the turn back and returns the time the wrong player was charged.
- When a clock runs out the card turns red and counts overtime. Nobody is knocked out.
- **Finish** shows a summary: time used, turns, time per turn, plus *Deep thinker* and *Quick draw* tags.

**Showtime**
- One lit segment per second (up to 60) that drains and shifts from your theme colour to amber to red.
- Final 5 seconds: beeps and a pulsing number. At zero: buzzer, screen flash and a "TIME'S UP!" banner.
- Question counter with **Next** (counter name can be Question, Round or Turn). +10 seconds at any time, even after the buzzer.
- **Stage view** fills the screen with the countdown, which is useful when mirroring to a TV. Tap the ring to start or pause.
- Settings: custom length, final beeps, buzzer, ticking clock, auto-start the next countdown.

**Stopwatch**
- Hundredths of a second; a sweep ring and dot that go round once a minute.
- Laps with lap time, change against the previous lap, split total and a bar for each lap's length. Fastest and slowest are tagged.
- The inner ring fills as your current lap approaches your best lap and changes colour when you go slower.
- Copy laps as text. Reset can be undone.

**Everywhere**: three themes (Voltage, Royal, Forest), sound and haptics switches, keyboard shortcuts, Reduce Motion support, and the screen stays awake while a clock runs.

**Switching modes**: Stopwatch and Showtime keep running in the background (the mode picker shows their live time). Duel and Group pause, because a turn clock should never run unseen. Every mode remembers its state if the app is closed.

**Keyboard** (handy on an iPad or laptop): Space is the main action in every mode; Duel P pause; Group U undo; Showtime N next, R reset, F stage view; Stopwatch L lap, R reset.

---

## Preview it

The app must be served from a web address (not opened as a file) for offline mode to work. Any of these will do:

- **Easiest:** deploy to GitHub Pages (below) and open the link on your iPhone.
- **On a computer:** in this folder run `python3 -m http.server 8000`, then open `http://localhost:8000`.
- **Run the tests (optional, needs Node.js):** `npm test`

## Deploy to GitHub Pages (all from an iPhone or any browser)

1. Sign in at **github.com** and tap **+ → New repository**. Name it `clockit`, set it to **Public**, and create it.
2. Tap **Add file → Upload files** and upload everything in this folder, keeping the folders (`js`, `icons`, `tests`). On iPhone it's easiest to unzip the project in the Files app first, then upload the files and folders. Make sure `.nojekyll` is included (Files may hide it; it's optional, the app works without it).
3. Tap **Commit changes**.
4. Open **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. After a minute or two the page shows your link, for example `https://YOUR-NAME.github.io/clockit/`.

All paths in the app are relative, so it works inside the `/clockit/` sub-folder that GitHub Pages uses.

### Publishing an update

1. Change the files and upload them again (Add file → Upload files replaces files with the same name).
2. **Raise the version** in `sw.js` (for example `var VERSION = '2.1.1'`) and, to match, `APP_VERSION` at the top of `js/app.js`. Without this, installed phones keep showing the old cached version.
3. Next time the app opens, it shows "A new version of ClockIt is ready" with an **Update** button. It never interrupts a running game.

## Install on an iPhone Home Screen

1. Open your GitHub Pages link in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open ClockIt from the Home Screen. It runs full screen, with no browser bars.
4. Open it once while online. After that it works in Airplane Mode. In Settings, the footer says "Offline ready" when caching has finished.

---

## Background behaviour and timing (please read)

- Time is measured from a monotonic clock and recalculated every frame, so a slow or skipped frame never makes the clock drift.
- **Browsers pause web apps that are not on screen.** iOS stops JavaScript when you lock the phone, switch apps, or sometimes when a notification banner appears. So by default, **Duel and Group pause when the app is hidden**, and tell you so when you come back.
- **Stopwatch and Showtime** measure from the time they started, so their time is always correct when you return, even after closing the app. But **no sounds can play while the app is closed or the phone is locked**: a countdown that ends in the background shows "time ran out" when you come back. Web apps can't send alarms or notifications here.
- If you turn *Pause when the app is hidden* off, the active player's clock is charged for the time away when you return (measured with the device clock). A flag that fell while you were away is only detected on return.
- Keep the phone unlocked and the app open during a game. The app asks the phone to keep the screen awake while a game is on.

## Known limitations and what needs real-device testing

- **Haptics on iPhone:** Safari has no vibration API. The app uses a known iOS 18+ technique (toggling a hidden system switch) that produces a light tap. It needs confirming on a real iPhone; on older iOS there will be no haptics. Android uses standard vibration.
- **Sound on iPhone:** the hardware silent switch also silences web audio. Sound unlocks on the first tap, as browsers require.
- **Screen wake lock:** supported in Safari 16.4+; it has been unreliable in Home Screen apps on some iOS versions. Check that the screen stays on during a long game; if not, set Auto-Lock to Never while playing.
- **Fonts:** the clock numerals use Apple's SF Pro Rounded on iPhone. Other systems fall back to their own rounded or sans-serif font, so screenshots on Android/Windows will look a little different.
- Tested in Chromium with iPhone-sized screens (iPhone SE 375×667, iPhone 15 393×852, landscape 844×390), including offline reload. **Still to check on a real iPhone:** tap responsiveness with two players tapping fast, Table mode readability across a real table, the safe areas around the notch / Dynamic Island and home indicator, haptics, sound volume, and Home Screen install.
- Settings are stored per device (in the browser's local storage). Clearing Safari website data resets them.

## Customising

- **Colours / new theme:** copy a theme block at the top of `styles.css` (e.g. `.app[data-theme="forest"]`), change the colours, then add a matching button in the Theme section of `index.html` and an entry in `THEME_COLORS` in `js/app.js`.
- **Chaos lines:** edit the lists in `js/chaos.js`.
- **Group colours:** the `--g0` to `--g7` tokens in the v2 section of `styles.css`.
- **Showtime presets:** the buttons in `#stPresets` in `index.html` (`data-sec` is the length in seconds).
- **Presets / bonus options:** the buttons are in `index.html`; allowed values are checked in `loadSettings()` in `js/app.js`.
- **Timer rules:** Duel lives in `js/engine.js`, the other modes in `js/timers.js`. Run `npm test` after changing either.

Tip for working with an AI assistant: paste the file you want changed plus this README, and ask it to keep the engine tests passing.

## Name note

There is an existing App Store app called "ClockIt – Time Clock App" (employee time tracking). That doesn't matter for a free web app on GitHub Pages, but check the name before any App Store submission or commercial launch.
