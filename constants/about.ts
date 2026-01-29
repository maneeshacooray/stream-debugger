/**
 * Developer / About info from package.json.
 * Shown when user taps the app title or in Settings > About.
 * Add "author" and "description" to package.json to customize.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json') as {
  name?: string;
  version?: string;
  author?: string | { name?: string; email?: string; url?: string };
  description?: string;
};

function formatAppName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getAuthor(author: typeof pkg.author): string {
  if (!author) return 'Your Name or Team';
  if (typeof author === 'string') return author;
  return author.name ?? 'Your Name or Team';
}

export const ABOUT = {
  appName: pkg.name ? formatAppName(pkg.name) : 'Stream Debugger',
  version: pkg.version ?? '1.0.0',
  developer: getAuthor(pkg.author),
  description:
    pkg.description ??
    'Debug and inspect HLS/stream playback, network quality, and playlist metadata.',
} as const;
