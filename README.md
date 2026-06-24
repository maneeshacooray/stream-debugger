<p align="center">
  <img src="assets/images/icon.png" width="96" alt="Stream Debugger icon" />
</p>

<h1 align="center">Stream Debugger</h1>

<p align="center">Debug and inspect HLS/stream playback, network quality, and playlist metadata.</p>

<p align="center">
  <a href="https://github.com/maneeshacooray/stream-debugger/actions/workflows/release.yml"><img src="https://github.com/maneeshacooray/stream-debugger/actions/workflows/release.yml/badge.svg" alt="Build and Release status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue.svg" alt="License: GPL-3.0" /></a>
  <img src="https://img.shields.io/badge/platform-Android%20%7C%20iOS%20%7C%20Web-informational" alt="Platforms" />
</p>

## Features

- HLS playback and segment inspection.
- Real-time bitrate and buffering metrics.
- Playlist (master/media) metadata analysis.
- Multi-view playback with customizable stream count.
- Android, iOS, and Web support from a single Expo codebase.

## Getting Started

Requires [Node.js](https://nodejs.org/) and the [Expo CLI](https://docs.expo.dev/more/expo-cli/) toolchain (installed automatically via `npx`).

```bash
npm ci
npm start
```

### Run on a Platform

| Platform | Command |
| :--- | :--- |
| Android | `npm run android` |
| iOS | `npm run ios` |
| Web | `npm run web` |

### Other Commands

- `npm run lint` — run ESLint.
- `npm run clean` — clear `node_modules` and reinstall.
- `npm run reset-project` — reset to a blank Expo template (see `scripts/reset-project.js`).

## Tech Stack

[Expo](https://expo.dev) · [expo-router](https://docs.expo.dev/router/introduction/) · [expo-video](https://docs.expo.dev/versions/latest/sdk/video/) · React Native · TypeScript

## Contributing

Issues and pull requests are welcome. Run `npm run lint` before submitting a PR — CI runs the same check on every push to `main`.

## License

[GPL-3.0](LICENSE)
