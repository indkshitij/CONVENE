import { promises as dns } from "node:dns";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export class SsrfBlockedError extends Error {}

// PRD §10.7.9 edge case 9: "Unfurler denies private/link-local/metadata
// ranges." Covers RFC 1918 (10/8, 172.16/12, 192.168/16), loopback
// (127/8, ::1), link-local (169.254/16 — this is also the cloud
// metadata range, 169.254.169.254, so no separate check is needed for
// it), the "this network" range (0/8), IPv6 unique-local (fc00::/7) and
// IPv6 link-local (fe80::/10). Pure and synchronous so it's trivially
// unit-testable against exact IPs without any network access.
export function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(":")) return isPrivateOrReservedIpv6(ip);
  return isPrivateOrReservedIpv4(ip);
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true; // Malformed — fail closed.
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (carrier-grade NAT)
  return false;
}

function isPrivateOrReservedIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase();
  if (ip === "::1") return true; // loopback
  if (ip === "::") return true; // unspecified
  if (ip.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — unwrap and re-check the embedded IPv4 address.
    const mapped = ip.slice("::ffff:".length);
    if (mapped.includes(".")) return isPrivateOrReservedIpv4(mapped);
  }
  const firstHextet = ip.split(":")[0] ?? "";
  const firstByte = Number.parseInt(firstHextet.padStart(2, "0").slice(0, 2), 16);
  if (!Number.isNaN(firstByte) && firstByte >= 0xfc && firstByte <= 0xfd) return true; // fc00::/7 (unique local)
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb"))
    return true; // fe80::/10
  return false;
}

export async function defaultResolver(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
}

// One instance guards every hop of a redirect chain — call
// assertHostIsSafe() again for every new Location header, which is what
// makes this a "DNS re-resolution guard against rebinding" rather than a
// single up-front check the fetch could bypass after the fact.
export class LinkUnfurlGuard {
  constructor(private readonly resolver: DnsResolver = defaultResolver) {}

  async assertHostIsSafe(hostname: string): Promise<void> {
    let addresses: ResolvedAddress[];
    try {
      addresses = await this.resolver(hostname);
    } catch {
      throw new SsrfBlockedError(`Could not resolve host: ${hostname}`);
    }
    if (addresses.length === 0) {
      throw new SsrfBlockedError(`Host resolved to no addresses: ${hostname}`);
    }
    for (const { address } of addresses) {
      if (isPrivateOrReservedIp(address)) {
        throw new SsrfBlockedError(
          `Host resolves to a private/reserved address: ${hostname} -> ${address}`,
        );
      }
    }
  }
}
