// Fails if a privileged credential appears in the production bundle.
// (Environment-variable *names* in help text are fine; secret *values* are not.)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  /sb_secret_[A-Za-z0-9_-]{10,}/, // new-style Supabase secret keys
  /-----BEGIN (RSA )?PRIVATE KEY-----/, // service-account / PEM keys
  /"type"\s*:\s*"service_account"/, // Google service-account JSON
  /GOCSPX-[A-Za-z0-9_-]{10,}/, // Google OAuth client secrets
];
const JWT = /eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;

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
  for (const m of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') {
        console.error(`✗ ${file} contains a service_role JWT`);
        failed = true;
      }
    } catch {
      /* not a JWT */
    }
  }
}
if (failed) process.exit(1);
console.log('✓ No privileged credentials found in dist/');
