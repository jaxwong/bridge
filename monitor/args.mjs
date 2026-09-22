// Command-line parsing for the monitor, kept separate from run.mjs so it can be tested
// without launching a browser.
//
//   node run.mjs urls.txt              scan every URL in a file
//   node run.mjs --url <URL>           scan one public job-application URL
//
// Both modes do exactly the same thing to the page: load it and read it. Neither fills a
// field, clicks a control, submits a form, or attempts a CAPTCHA, and neither carries any
// stored credentials, so a site that needs a login is reported rather than entered.

export const USAGE = [
  'usage:',
  '  node run.mjs <urls-file>        scan every URL listed in the file',
  '  node run.mjs --url <URL>        scan one public job-application URL',
  '',
  'In a URL file, one URL per line; blank lines and lines starting with # are ignored.',
  'Only http and https URLs are accepted. The monitor reads pages and never submits them.',
].join('\n');

/** Only schemes that fetch a web page. file: and data: would read local or inline content. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export class ArgError extends Error {}

const fail = (message) => { throw new ArgError(message); };

/**
 * Parse the monitor's arguments.
 *
 * @param {string[]} argv normally `process.argv.slice(2)`
 * @returns {{mode: 'file', file: string} | {mode: 'url', url: string}}
 * @throws {ArgError} with a message naming what was wrong. Never falls back to a default:
 *   guessing which URL was meant is how the wrong site gets scanned.
 */
export function parseArgs(argv) {
  if (!Array.isArray(argv)) fail('arguments must be an array');
  const args = argv.filter((a) => a !== '');
  if (args.length === 0) fail('no arguments given');

  const urlFlags = args.filter((a) => a === '--url' || a.startsWith('--url='));
  if (urlFlags.length > 1) fail('--url was given more than once; scan one URL at a time');

  if (urlFlags.length === 0) {
    const unknown = args.find((a) => a.startsWith('--'));
    if (unknown) fail(`unknown option "${unknown}"`);
    if (args.length > 1) fail(`expected one URL file, got ${args.length} arguments`);
    return { mode: 'file', file: args[0] };
  }

  const flag = urlFlags[0];
  let value;
  let consumed;
  if (flag.startsWith('--url=')) {
    value = flag.slice('--url='.length);
    consumed = [flag];
  } else {
    const i = args.indexOf(flag);
    value = args[i + 1];
    if (value === undefined) fail('--url needs a URL after it');
    if (value.startsWith('--')) fail(`--url needs a URL after it, got "${value}"`);
    consumed = [flag, value];
  }

  const extra = args.filter((a) => !consumed.includes(a));
  if (extra.length) fail(`--url takes one URL; also got ${extra.map((e) => `"${e}"`).join(', ')}`);
  if (!value) fail('--url needs a URL after it');

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`"${value}" is not a URL`);
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    fail(`"${value}" uses ${parsed.protocol} — only http and https URLs can be scanned`);
  }
  return { mode: 'url', url: parsed.href };
}
