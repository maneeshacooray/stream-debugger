# stream-debugger

Debug my f*cking stream

## Features

- HLS playback and segment inspection.
- Real-time bitrate and buffering metrics.
- Playlist (master/media) metadata analysis.
- Android, iOS, and Web support.

## Setup

The project uses a `Makefile` for common tasks.

### Installation

```bash
make install
```

### Development

```bash
make start
```

### Run on Platforms

| Platform | Command |
| :--- | :--- |
| Android | `make android` |
| iOS | `make ios` |
| Web | `make web` |

## Other Commands

- `make lint`: Run ESLint.
- `make clean`: Clear `node_modules` and reinstall.
- `make help`: Show all available commands.

---

Built with Expo
