#!/usr/bin/env node

import { mkdir, lstat, symlink, unlink, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function isGlobalInstall() {
  return process.env.npm_config_global === 'true';
}

function getGlobalPrefix() {
  return execSync('npm config get prefix', { encoding: 'utf8' }).trim();
}

async function ensureSymlink(linkPath, targetPath) {
  try {
    const stat = await lstat(linkPath);
    if (stat.isSymbolicLink()) {
      await unlink(linkPath);
    } else {
      return;
    }
  } catch {
    // link does not exist — create below
  }

  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(targetPath, linkPath);
}

async function main() {
  if (!isGlobalInstall()) return;

  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const target = resolve(pkgRoot, 'dist/index.js');
  await chmod(target, 0o755);

  const prefix = getGlobalPrefix();
  const link = resolve(prefix, 'bin/orc-lite');
  await ensureSymlink(link, target);
}

main().catch(() => {
  // Best effort only: don't fail installation if environment blocks link creation.
});
