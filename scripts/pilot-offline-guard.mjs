import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

const fail = () => { throw new Error('PILOT_OFFLINE_NETWORK'); };
globalThis.fetch = fail;
http.request = fail;
http.get = fail;
https.request = fail;
https.get = fail;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const host = typeof first === 'object' ? first.host ?? first.hostname : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) fail();
  return connect.apply(this, args);
};
