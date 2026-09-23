/**
 * PBKDF2-HMAC-SHA256, written for Hermes.
 *
 * Hermes has no JIT, and a general-purpose SHA-256 (hash objects, buffers
 * copied per update) spends most of its time on bookkeeping: 210,000
 * iterations took over half a minute on a phone. PBKDF2's inner loop is always
 * the same shape - HMAC of a 32-byte value - so each iteration here is exactly
 * two SHA-256 block compressions from states prepared once, into typed arrays
 * allocated once, with nothing allocated inside the loop.
 *
 * Checked against @noble/hashes and the RFC 7914 test vectors.
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** One SHA-256 compression of the 16 words in w[0..15] into state (8 words). */
function compress(state: Int32Array, w: Int32Array): void {
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15];
    const y = w[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0; state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0; state[7] = (state[7] + h) | 0;
}

/** Plain SHA-256 of a byte array, for the few variable-length inputs. */
function sha256Bytes(data: Uint8Array, initial: Int32Array = new Int32Array(IV), prefixBytes = 0): Int32Array {
  const state = initial;
  const total = prefixBytes + data.length;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const bits = total * 8;
  padded[padded.length - 4] = (bits >>> 24) & 0xff;
  padded[padded.length - 3] = (bits >>> 16) & 0xff;
  padded[padded.length - 2] = (bits >>> 8) & 0xff;
  padded[padded.length - 1] = bits & 0xff;
  const w = new Int32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = (padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3];
    }
    compress(state, w);
  }
  return state;
}

/**
 * PBKDF2-HMAC-SHA256 for a 32-byte key (one output block, all this app needs).
 * `onProgress` is awaited between batches, so the UI keeps running.
 */
export async function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  yieldEvery = 2000,
): Promise<Uint8Array> {
  // HMAC key: hashed first if longer than the block
  let key = password;
  if (key.length > 64) {
    const h = sha256Bytes(key);
    key = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      key[i * 4] = h[i] >>> 24; key[i * 4 + 1] = h[i] >>> 16; key[i * 4 + 2] = h[i] >>> 8; key[i * 4 + 3] = h[i];
    }
  }
  const ipadBlock = new Uint8Array(64).fill(0x36);
  const opadBlock = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < key.length; i++) { ipadBlock[i] ^= key[i]; opadBlock[i] ^= key[i]; }

  // States after the padded key block, prepared once
  const w = new Int32Array(64);
  const loadBlock = (block: Uint8Array) => {
    for (let i = 0; i < 16; i++) w[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
  };
  const ipadState = new Int32Array(IV); loadBlock(ipadBlock); compress(ipadState, w);
  const opadState = new Int32Array(IV); loadBlock(opadBlock); compress(opadState, w);

  // U1 = HMAC(password, salt || INT(1))
  const saltBlock = new Uint8Array(salt.length + 4);
  saltBlock.set(salt);
  saltBlock[salt.length + 3] = 1;
  const inner1 = sha256Bytes(saltBlock, new Int32Array(ipadState), 64);
  const u = new Int32Array(8);
  const outerIn = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    outerIn[i * 4] = inner1[i] >>> 24; outerIn[i * 4 + 1] = inner1[i] >>> 16; outerIn[i * 4 + 2] = inner1[i] >>> 8; outerIn[i * 4 + 3] = inner1[i];
  }
  u.set(sha256Bytes(outerIn, new Int32Array(opadState), 64));
  const t = new Int32Array(u);

  // Every later iteration: HMAC of a 32-byte value = two single-block compressions
  // with fixed padding (0x80 then the 96-byte message length, 768 bits)
  const state = new Int32Array(8);
  for (let n = 1; n < iterations; n++) {
    state.set(ipadState);
    for (let i = 0; i < 8; i++) w[i] = u[i];
    w[8] = 0x80000000 | 0; w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0; w[15] = 768;
    compress(state, w);
    for (let i = 0; i < 8; i++) w[i] = state[i];
    state.set(opadState);
    w[8] = 0x80000000 | 0; w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0; w[15] = 768;
    compress(state, w);
    for (let i = 0; i < 8; i++) { u[i] = state[i]; t[i] ^= state[i]; }
    if (n % yieldEvery === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = t[i] >>> 24; out[i * 4 + 1] = t[i] >>> 16; out[i * 4 + 2] = t[i] >>> 8; out[i * 4 + 3] = t[i];
  }
  return out;
}
