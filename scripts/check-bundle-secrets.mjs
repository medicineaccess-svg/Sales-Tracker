// Fails if a privileged credential appears in the production bundle.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  /service_role/i,
  /sb_secret_[A-Za-z0-9_-]+/,
  /-----BEGIN (RSA )?PRIVATE KEY-----/,
  /"type"\s*:\s*"service_account"/,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /GOOGLE_SERVICE_ACCOUNT_JSON/,
];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let failed = false;
for (const file of walk('dist')) {
  if (!/\.(js|html|css|map|json)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const re of PATTERNS) {
    if (re.test(text)) {
      console.error(`✗ ${file} matches ${re}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('✓ No privileged credentials found in dist/');
