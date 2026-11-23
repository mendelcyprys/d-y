// The Daf Yomi backup service: a Cloudflare Worker with two kinds of Durable
// Object, one holding all accounts and one per account holding its backup.
// A Durable Object handles one request at a time, which is what makes
// "save only if nobody else has changed this since" reliable.

import { DurableObject } from 'cloudflare:workers';
import { handle } from './handler.js';
import { durableObjectDb } from './db.js';
import { accounts } from './accounts.js';
import { userStore } from './store.js';

export class Accounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.api = accounts(durableObjectDb(ctx.storage.sql));
  }

  signup(username, password, address) { return this.api.signup(username, password, address); }
  login(username, password, address) { return this.api.login(username, password, address); }
  verify(token) { return this.api.verify(token); }
  logout(token) { return this.api.logout(token); }
  recover(username, code, newPassword) { return this.api.recover(username, code, newPassword); }
  changePassword(userId, password, newPassword) { return this.api.changePassword(userId, password, newPassword); }
  deleteAccount(userId, password) { return this.api.deleteAccount(userId, password); }
}

export class UserStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.api = userStore(durableObjectDb(ctx.storage.sql));
  }

  changes(since) { return this.api.changes(since); }
  write(items) { return this.api.write(items); }
  deleteAll() { return this.api.deleteAll(); }
}

export default {
  fetch(request, env) {
    return handle(request, env, {
      accounts: () => env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')),
      store: (userId) => env.USER_STORE.get(env.USER_STORE.idFromName(userId)),
    });
  },
};
