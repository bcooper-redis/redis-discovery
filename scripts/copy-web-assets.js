const fs = require('fs');

fs.cpSync('src/web/public', 'dist/web/public', { recursive: true });

// The user guide lives at the repo root (that's what gets edited/regenerated
// to PDF), not under src/web/public — copy it in at build time so the Web
// UI can link to it without keeping a second copy to keep in sync by hand.
fs.cpSync('redis_discovery_user_guide.html', 'dist/web/public/user-guide.html');

// tsc writes dist/cli/index.js without the executable bit, so `npm link`
// and global installs fail with "permission denied" despite the shebang.
fs.chmodSync('dist/cli/index.js', 0o755);

try {
  fs.cpSync('node_modules/htmx.org/dist/htmx.min.js', 'dist/web/public/htmx.min.js');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(
      'Could not find node_modules/htmx.org — run `npm install` first, then `npm run build`.',
    );
    process.exit(1);
  }
  throw err;
}
