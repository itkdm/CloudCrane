import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
for (const [subnet, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.88.99.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['::ffff:0:0', 96, 'ipv6'],
  ['100::', 64, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
  ['2001:10::', 28, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
] as const) {
  (family === 'ipv4' ? blockedIpv4Addresses : blockedIpv6Addresses).addSubnet(
    subnet,
    prefix,
    family,
  );
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family > 0 &&
    !(family === 4 ? blockedIpv4Addresses : blockedIpv6Addresses).check(
      address,
      family === 4 ? 'ipv4' : 'ipv6',
    )
  );
}

async function resolvePublicAddress(hostname: string) {
  const unwrappedHostname = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    unwrappedHostname === 'localhost' ||
    unwrappedHostname.endsWith('.localhost') ||
    unwrappedHostname.endsWith('.local') ||
    unwrappedHostname.endsWith('.internal')
  )
    throw new TypeError('provider endpoint host is not publicly reachable');

  const addresses = isIP(unwrappedHostname)
    ? [{ address: unwrappedHostname, family: isIP(unwrappedHostname) }]
    : await lookup(unwrappedHostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new TypeError('provider endpoint host must resolve only to public addresses');

  const selected = addresses[0];
  if (!selected) throw new TypeError('provider endpoint host has no public address');
  return selected;
}

export async function assertPublicProviderHost(hostname: string): Promise<void> {
  await resolvePublicAddress(hostname);
}

function requestBody(body: BodyInit | null | undefined): string | Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError('provider request body type is unsupported');
}

function responseHeaders(rawHeaders: string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name && value !== undefined) headers.append(name, value);
  }
  return headers;
}

/** Fetch implementation for Pi custom providers: pins public DNS results and never follows redirects. */
export function createSecureProviderFetch(baseUrl: string): typeof fetch {
  const expected = new URL(baseUrl);
  const basePath = expected.pathname.replace(/\/$/, '');

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (
      url.protocol !== 'https:' ||
      url.origin !== expected.origin ||
      (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))
    )
      throw new TypeError('provider request target is outside the configured HTTPS endpoint');

    const resolvedAddress = await resolvePublicAddress(url.hostname);
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options?.all) callback(null, [resolvedAddress]);
      else callback(null, resolvedAddress.address, resolvedAddress.family);
    };
    const headers = new Headers(init?.headers);
    const body = requestBody(init?.body);

    return await new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(headers.entries()),
          signal: init?.signal ?? undefined,
          lookup: pinnedLookup,
        },
        (response) => {
          const status = response.statusCode ?? 502;
          resolve(
            new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
              status,
              statusText: response.statusMessage,
              headers: responseHeaders(response.rawHeaders),
            }),
          );
        },
      );
      request.once('error', reject);
      request.end(body);
    });
  };
}
