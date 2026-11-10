// Auto-open state shared by the CLI and the hooks (snooze and launch lock), kept in ~/.agent-floor.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = process.env.AGENT_FLOOR_HOME || path.join(os.homedir(), '.agent-floor');
const SNOOZE = path.join(DIR, 'snoozed-until');
const LOCK = path.join(DIR, 'launch.lock');

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

/** Stop hooks from opening the app for `hours`. */
function snooze(hours) {
  ensureDir();
  fs.writeFileSync(SNOOZE, String(Date.now() + hours * 3600_000));
}

function isSnoozed() {
  try {
    return Date.now() < Number(fs.readFileSync(SNOOZE, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Only one hook may launch the app at a time: parallel subagents fire many
 * hooks at once. Returns true if this process won the right to launch.
 */
function takeLaunchLock(staleMs = 20_000) {
  ensureDir();
  try {
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age < staleMs) return false;
    fs.unlinkSync(LOCK);
  } catch {
    /* no lock yet */
  }
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { DIR, snooze, isSnoozed, takeLaunchLock };
