// Preload (node --import) that makes any outbound network attempt throw.
// Process-level guard for the "no network" check; it is not OS-level isolation.
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

const deny = (what) => () => {
  throw new Error(`network access blocked by block-network.mjs (${what})`);
};

net.Socket.prototype.connect = deny("net.Socket.connect");
net.connect = deny("net.connect");
net.createConnection = deny("net.createConnection");
tls.connect = deny("tls.connect");
dns.lookup = deny("dns.lookup");
dns.resolve = deny("dns.resolve");
dns.promises.lookup = deny("dns.promises.lookup");
globalThis.fetch = deny("fetch");
globalThis.__NETWORK_BLOCKED__ = true;
