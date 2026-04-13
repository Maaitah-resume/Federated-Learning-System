#!/usr/bin/env node
const { spawn } = require('child_process');

// Determine which compose command to use: prefer `docker compose`, fall back to `docker-compose`.
const tryCmds = ['docker compose', 'docker-compose'];

function runCompose(cmd) {
  const p = spawn(cmd, ['up', '--build'], { stdio: 'inherit', shell: true });

  p.on('close', (code) => {
    process.exit(code);
  });
  p.on('error', (err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}

(async () => {
  // Try the preferred commands sequentially
  for (const c of tryCmds) {
    try {
      // spawn with `--version` to test availability
      const test = spawn(c, ['--version'], { shell: true });
      await new Promise((resolve, reject) => {
        test.on('exit', (code) => (code === 0 ? resolve() : reject()));
        test.on('error', reject);
      });
      // if we reach here, the command exists — run compose up
      runCompose(c);
      return;
    } catch (e) {
      // try next
    }
  }

  console.error('Neither `docker compose` nor `docker-compose` appear to be available in PATH.');
  console.error('Install Docker Desktop or ensure docker-compose is installed.');
  process.exit(1);
})();
