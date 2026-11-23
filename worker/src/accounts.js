// Accounts: usernames, passwords, sessions and recovery codes. One instance
// (a single Durable Object) holds them all.
//
// - A password is stored only as a slow salted hash (see crypto.js).
// - Logging in gives a session token, a long random code the app keeps; only
//   a hash of it is stored. Sessions last a year from last use.
// - Signing up also gives a recovery code, shown once: with it you can set a
//   new password if you forget yours. Only a hash of it is stored.
// - Repeated failed attempts are slowed down per username and per address.
//
// Every method returns { ok: true, ... } or { error, status, message }.

import { randomBytes, toBase64Url, sha256Hex, hashPassword, verifyPassword } from './crypto.js';

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const DAY = 24 * 60 * 60 * 1000;
const SESSION_LIFE = 365 * DAY;
const CODE_ALPHABET = 'abcdefghjkmnpqrstvwxyz0123456789';

const LIMITS = {
  login: { max: 10, window: 15 * 60 * 1000 }, // per username
  loginAddress: { max: 30, window: 15 * 60 * 1000 }, // per address
  signup: { max: 5, window: 60 * 60 * 1000 }, // per address
  recover: { max: 5, window: 60 * 60 * 1000 }, // per username
};

const fail = (status, error, message) => ({ error, status, message });

export const normalizeUsername = (name) => String(name || '').trim().toLowerCase();
export const normalizeRecoveryCode = (code) => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return fail(400, 'weak_password', 'Your password needs at least 8 characters.');
  if (password.length > 200) return fail(400, 'weak_password', 'That password is too long.');
  return null;
}

export function accounts(db, { now = () => Date.now(), random = randomBytes, iterations } = {}) {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    recovery TEXT NOT NULL, created TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)`);
  db.run('CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id)');
  db.run(`CREATE TABLE IF NOT EXISTS attempts (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)`);

  const hash = (password) => hashPassword(password, iterations);

  // ---- Slowing down guessing.
  function limited(key, { max, window }) {
    const row = db.all('SELECT count, window_start FROM attempts WHERE key = ?', key)[0];
    return Boolean(row && now() - row.window_start < window && row.count >= max);
  }
  function attempt(key, { window }) {
    const row = db.all('SELECT count, window_start FROM attempts WHERE key = ?', key)[0];
    if (!row || now() - row.window_start >= window) {
      db.run('INSERT OR REPLACE INTO attempts (key, count, window_start) VALUES (?, 1, ?)', key, now());
    } else {
      db.run('UPDATE attempts SET count = count + 1 WHERE key = ?', key);
    }
  }
  const forget = (key) => db.run('DELETE FROM attempts WHERE key = ?', key);
  const tooMany = () => fail(429, 'too_many_attempts', 'Too many attempts. Please wait a while and try again.');

  // ---- Sessions and codes.
  async function newSession(userId) {
    const token = toBase64Url(random(32));
    db.run('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)', await sha256Hex(token), userId, now() + SESSION_LIFE);
    return token;
  }
  function newRecoveryCode() {
    const code = [...random(20)].map((b) => CODE_ALPHABET[b % 32]).join('');
    return code.match(/.{4}/g).join('-');
  }
  const findUser = (username) => db.all('SELECT * FROM users WHERE username = ?', username)[0];
  const endSessions = (userId) => db.run('DELETE FROM sessions WHERE user_id = ?', userId);

  return {
    async signup(username, password, address = '') {
      const name = normalizeUsername(username);
      if (!USERNAME.test(name)) {
        return fail(400, 'invalid_username', 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores, starting with a letter or number.');
      }
      const weak = checkPassword(password);
      if (weak) return weak;
      if (limited(`signup:${address}`, LIMITS.signup)) return tooMany();
      if (findUser(name)) return fail(409, 'username_taken', 'That username is taken. Please choose another.');
      attempt(`signup:${address}`, LIMITS.signup);
      const id = [...random(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const recoveryCode = newRecoveryCode();
      const [passwordHash, recoveryHash] = await Promise.all([hash(password), sha256Hex(normalizeRecoveryCode(recoveryCode))]);
      try {
        db.run('INSERT INTO users (username, id, password, recovery, created) VALUES (?, ?, ?, ?, ?)',
          name, id, passwordHash, recoveryHash, new Date(now()).toISOString());
      } catch {
        return fail(409, 'username_taken', 'That username is taken. Please choose another.');
      }
      return { ok: true, username: name, token: await newSession(id), recoveryCode };
    },

    async login(username, password, address = '') {
      const name = normalizeUsername(username);
      if (limited(`login:${name}`, LIMITS.login) || limited(`login@${address}`, LIMITS.loginAddress)) return tooMany();
      const user = findUser(name);
      // Check a password even for unknown names, so timing doesn't reveal which exist.
      const good = await verifyPassword(String(password || ''), user?.password || 'pbkdf2-sha256$1000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      if (!user || !good) {
        attempt(`login:${name}`, LIMITS.login);
        attempt(`login@${address}`, LIMITS.loginAddress);
        return fail(401, 'bad_credentials', "That username and password don't match.");
      }
      forget(`login:${name}`);
      return { ok: true, username: name, token: await newSession(user.id) };
    },

    /** The account a session token belongs to, or null. */
    async verify(token) {
      if (typeof token !== 'string' || token.length < 20) return null;
      const tokenHash = await sha256Hex(token);
      const row = db.all(`SELECT s.user_id AS id, s.expires, u.username FROM sessions s
        JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, tokenHash)[0];
      if (!row || row.expires < now()) return null;
      // Keep sessions you use alive, without writing on every request.
      if (row.expires - now() < SESSION_LIFE - DAY) db.run('UPDATE sessions SET expires = ? WHERE token_hash = ?', now() + SESSION_LIFE, tokenHash);
      return { id: row.id, username: row.username };
    },

    async logout(token) {
      db.run('DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(String(token || '')));
      return { ok: true };
    },

    /** Set a new password with the recovery code. Logs out everywhere else and gives a new code. */
    async recover(username, recoveryCode, newPassword) {
      const name = normalizeUsername(username);
      const weak = checkPassword(newPassword);
      if (weak) return weak;
      if (limited(`recover:${name}`, LIMITS.recover)) return tooMany();
      const user = findUser(name);
      if (!user || (await sha256Hex(normalizeRecoveryCode(recoveryCode))) !== user.recovery) {
        attempt(`recover:${name}`, LIMITS.recover);
        return fail(401, 'bad_recovery', "That username and recovery code don't match.");
      }
      const code = newRecoveryCode();
      const [passwordHash, recoveryHash] = await Promise.all([hash(newPassword), sha256Hex(normalizeRecoveryCode(code))]);
      db.run('UPDATE users SET password = ?, recovery = ? WHERE id = ?', passwordHash, recoveryHash, user.id);
      endSessions(user.id);
      forget(`recover:${name}`);
      forget(`login:${name}`);
      return { ok: true, username: name, token: await newSession(user.id), recoveryCode: code };
    },

    /** Change password while logged in. Logs out everywhere else. */
    async changePassword(userId, password, newPassword) {
      const user = db.all('SELECT * FROM users WHERE id = ?', userId)[0];
      if (!user) return fail(401, 'signed_out', 'Please log in again.');
      const weak = checkPassword(newPassword);
      if (weak) return weak;
      if (limited(`login:${user.username}`, LIMITS.login)) return tooMany();
      if (!(await verifyPassword(String(password || ''), user.password))) {
        attempt(`login:${user.username}`, LIMITS.login);
        return fail(401, 'bad_credentials', "That isn't your current password.");
      }
      db.run('UPDATE users SET password = ? WHERE id = ?', await hash(newPassword), userId);
      endSessions(userId);
      return { ok: true, username: user.username, token: await newSession(userId) };
    },

    /** Delete the account (the caller then deletes its backup). */
    async deleteAccount(userId, password) {
      const user = db.all('SELECT * FROM users WHERE id = ?', userId)[0];
      if (!user) return fail(401, 'signed_out', 'Please log in again.');
      if (limited(`login:${user.username}`, LIMITS.login)) return tooMany();
      if (!(await verifyPassword(String(password || ''), user.password))) {
        attempt(`login:${user.username}`, LIMITS.login);
        return fail(401, 'bad_credentials', "That isn't your password.");
      }
      endSessions(userId);
      db.run('DELETE FROM users WHERE id = ?', userId);
      return { ok: true };
    },
  };
}
