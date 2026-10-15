/**
 * Device biometrics (fingerprint / face / Windows Hello) through WebAuthn, used purely
 * as a local "is the owner here right now" check. The credential never leaves the
 * device and there is no server verification — the threat this gate answers is someone
 * picking up an already-unlocked phone or computer, and the platform authenticator
 * with `userVerification: "required"` is what makes that person unable to pass.
 */

const credentialKey = (userId: string) => `study-lock:credential:${userId}`;
const declinedKey = (userId: string) => `study-lock:declined:${userId}`;

function toBase64Url(bytes: ArrayBuffer) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** True when this device can verify the user with a built-in biometric / screen-lock authenticator. */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function hasDeviceCredential(userId: string): boolean {
  try {
    return !!localStorage.getItem(credentialKey(userId));
  } catch {
    return false;
  }
}

export function hasDeclinedBiometric(userId: string): boolean {
  try {
    return localStorage.getItem(declinedKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function setDeclinedBiometric(userId: string, declined: boolean) {
  try {
    if (declined) localStorage.setItem(declinedKey(userId), "1");
    else localStorage.removeItem(declinedKey(userId));
  } catch {
    // Storage blocked — the prompt will simply be offered again.
  }
}

export function forgetDeviceCredential(userId: string) {
  try {
    localStorage.removeItem(credentialKey(userId));
  } catch {
    // Nothing to forget.
  }
}

/** Registers this device's biometric. Prompts the OS once; resolves false if cancelled or unsupported. */
export async function enrollBiometric(userId: string): Promise<boolean> {
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "Study Notes" },
        user: { id: new TextEncoder().encode(userId), name: "study-notes-lock", displayName: "Study Notes" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "discouraged",
        },
        timeout: 60_000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;
    if (!credential) return false;
    localStorage.setItem(credentialKey(userId), toBase64Url(credential.rawId));
    setDeclinedBiometric(userId, false);
    return true;
  } catch {
    return false;
  }
}

/** Asks the OS to verify the user. Resolves false on cancel, failure, or when nothing is enrolled here. */
export async function verifyBiometric(userId: string): Promise<boolean> {
  try {
    const stored = localStorage.getItem(credentialKey(userId));
    if (!stored) return false;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [{ type: "public-key", id: fromBase64Url(stored), transports: ["internal"] }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}
