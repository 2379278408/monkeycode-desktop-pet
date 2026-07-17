# MonkeyCode Desktop Pet

A Windows desktop pet that monitors MonkeyCode SaaS task status and daily quota usage.

## Features

- Monkey mascot character sitting on your desktop
- Real-time daily token quota monitoring
- Task status notifications (processing, finished, error)
- System tray integration
- Bubble card panel with detailed info

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build Windows EXE
npm run build
```

## Tech Stack

- Electron 35+
- React 19
- TypeScript
- Zustand
- Lottie
- electron-builder

## Login

Uses the official MonkeyCode web page for authentication. No passwords are stored locally - only the session cookie is persisted securely.
