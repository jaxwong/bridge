// Monitor argument parsing. No browser, no network: parseArgs is pure.
// Run: node test/args.test.mjs

import { ArgError, parseArgs } from '../args.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const rejects = (name, argv, expect) => {
  try {
    const got = parseArgs(argv);
    check(name, false, `no error; returned ${JSON.stringify(got)}`);
  } catch (e) {
    if (!(e instanceof ArgError)) return check(name, false, `threw ${e.constructor.name}, not ArgError`);
    check(name, expect.test(e.message), e.message);
  }
};

// --- the existing urls.txt workflow still works -------------------------------------
const file = parseArgs(['urls.txt']);
check('a bare path is still a URL file', file.mode === 'file' && file.file === 'urls.txt', JSON.stringify(file));
check('a path with directories is still a URL file',
  parseArgs(['../monitor/urls.txt']).file === '../monitor/urls.txt');

// --- one public URL, directly --------------------------------------------------------
const one = parseArgs(['--url', 'https://boards.greenhouse.io/example/jobs/1']);
check('--url takes one URL', one.mode === 'url' && one.url === 'https://boards.greenhouse.io/example/jobs/1', JSON.stringify(one));
check('--url=VALUE works too',
  parseArgs(['--url=https://jobs.lever.co/example/1']).url === 'https://jobs.lever.co/example/1');
check('http is accepted, for the local fixture',
  parseArgs(['--url', 'http://localhost:8765/']).url === 'http://localhost:8765/');
check('a query string survives, because the scanned page needs it',
  parseArgs(['--url', 'http://localhost:8765/?v=3']).url === 'http://localhost:8765/?v=3');

// --- everything ambiguous is refused rather than guessed ------------------------------
rejects('no arguments at all', [], /no arguments given/);
rejects('--url with nothing after it', ['--url'], /--url needs a URL after it/);
rejects('--url followed by another option', ['--url', '--quiet'], /needs a URL after it/);
rejects('--url given twice', ['--url', 'https://a.test/', '--url', 'https://b.test/'], /more than once/);
rejects('a URL file and --url together', ['urls.txt', '--url', 'https://a.test/'], /takes one URL/);
rejects('two URL files', ['a.txt', 'b.txt'], /expected one URL file/);
rejects('an unknown option', ['--everything'], /unknown option "--everything"/);
rejects('a string that is not a URL', ['--url', 'boards.greenhouse.io/jobs/1'], /is not a URL/);
rejects('an empty --url', ['--url='], /needs a URL after it/);

// A file: URL would make the monitor read the local disk, and a javascript: or data: URL
// would run whatever the argument contained. Only page fetches are allowed.
rejects('a file: URL', ['--url', 'file:///etc/passwd'], /only http and https/);
rejects('a data: URL', ['--url', 'data:text/html,<form><input></form>'], /only http and https/);
rejects('a javascript: URL', ['--url', 'javascript:alert(1)'], /only http and https/);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
