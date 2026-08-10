import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp, LinkUnfurlGuard, SsrfBlockedError } from "./link-unfurl-guard";

describe("isPrivateOrReservedIp", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.255.255.255", true],
    ["169.254.169.254", true], // cloud metadata endpoint
    ["169.254.0.1", true],
    ["10.0.0.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["0.0.0.0", true],
    ["100.64.0.1", true],
    ["::1", true],
    ["fc00::1", true],
    ["fe80::1", true],
    ["::ffff:127.0.0.1", true],
  ] as const)("flags %s as private/reserved: %s", (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  it.each([
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false], // example.com
    ["172.15.255.255", false], // just outside 172.16/12
    ["172.32.0.1", false], // just outside 172.16/12
    ["2606:4700:4700::1111", false], // public IPv6 (Cloudflare)
  ] as const)("does not flag public %s", (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe("LinkUnfurlGuard.assertHostIsSafe", () => {
  it("rejects a host resolving to 127.0.0.1", async () => {
    const guard = new LinkUnfurlGuard(async () => [{ address: "127.0.0.1", family: 4 }]);
    await expect(guard.assertHostIsSafe("localhost")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects a host resolving to the cloud metadata address 169.254.169.254", async () => {
    const guard = new LinkUnfurlGuard(async () => [{ address: "169.254.169.254", family: 4 }]);
    await expect(guard.assertHostIsSafe("metadata.internal")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it("rejects when any resolved address (of several) is private", async () => {
    const guard = new LinkUnfurlGuard(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(guard.assertHostIsSafe("multi-homed.example.com")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it("rejects when DNS resolution fails (fail closed)", async () => {
    const guard = new LinkUnfurlGuard(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(guard.assertHostIsSafe("does-not-exist.invalid")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it("rejects when a host resolves to zero addresses (fail closed)", async () => {
    const guard = new LinkUnfurlGuard(async () => []);
    await expect(guard.assertHostIsSafe("nowhere.example.com")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it("allows a host resolving only to public addresses", async () => {
    const guard = new LinkUnfurlGuard(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(guard.assertHostIsSafe("example.com")).resolves.toBeUndefined();
  });
});
