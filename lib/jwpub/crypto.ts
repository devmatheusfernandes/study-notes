"use client";

import type { JwpubPublicationMeta } from "./types";

/**
 * Fixed 32-byte value the derived SHA-256 hash is XOR'd against to produce the
 * AES key + IV. Part of the .jwpub container format, not a secret of ours.
 */
const KEY_CONSTANT_HEX =
  "11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7";

export interface JwpubCryptoKeys {
  key: CryptoKey;
  iv: Uint8Array;
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Derives the container's AES-CBC key from the Publication row:
 * SHA-256("{meps}_{symbol}_{year}[_{issue}]") XOR constant, then bytes
 * 0..16 are the key and 16..32 the IV.
 *
 * The `_{issue}` segment is omitted when IssueTagNumber is 0/absent — getting
 * that conditional wrong makes every chapter decrypt to garbage, which is why
 * the parser validates that decrypted output actually starts with `<`.
 */
export async function deriveJwpubKeys(meta: JwpubPublicationMeta): Promise<JwpubCryptoKeys | null> {
  if (meta.mepsLanguageIndex === null || !meta.symbol || meta.year === null) return null;

  let hashInput = `${meta.mepsLanguageIndex}_${meta.symbol}_${meta.year}`;
  if (meta.issueTagNumber && Number(meta.issueTagNumber) !== 0) {
    hashInput += `_${meta.issueTagNumber}`;
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
  const hash = new Uint8Array(digest);
  const constant = hexToBytes(KEY_CONSTANT_HEX);

  const derived = new Uint8Array(32);
  for (let i = 0; i < 32; i++) derived[i] = hash[i] ^ constant[i];

  const key = await crypto.subtle.importKey(
    "raw",
    derived.slice(0, 16) as BufferSource,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );

  return { key, iv: derived.slice(16, 32) };
}

/**
 * Turns one `Document.Content`/`Footnote.Content` BLOB into HTML.
 *
 * Publications vary: some are AES-CBC encrypted then deflated, some only
 * deflated, some plain. `0x3c` is `<`, so content already starting with it is
 * raw HTML and needs nothing. Everything else is attempted decrypt-then-inflate
 * first, falling back to inflate-only, then to a raw decode.
 */
export async function decodeJwpubContent(
  raw: Uint8Array,
  keys: JwpubCryptoKeys | null,
  inflate: (input: Uint8Array) => Uint8Array
): Promise<string> {
  if (raw.length === 0) return "";
  if (raw[0] === 0x3c) return new TextDecoder().decode(raw as BufferSource);

  if (keys) {
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: keys.iv as BufferSource },
        keys.key,
        raw as BufferSource
      );
      const bytes = new Uint8Array(decrypted);
      const text = new TextDecoder().decode(
        (bytes[0] === 0x3c ? bytes : inflate(bytes)) as BufferSource
      );
      if (text.includes("<")) return text;
    } catch {
      // Not encrypted with this key (or not encrypted at all) — fall through.
    }
  }

  try {
    return new TextDecoder().decode(inflate(raw) as BufferSource);
  } catch {
    return new TextDecoder().decode(raw as BufferSource);
  }
}
