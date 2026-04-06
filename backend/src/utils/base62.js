// ─── Base62 Encoder / Decoder ─────────────────────────────────────────────────
//
// WHAT IS BASE62?
//   It's a numeral system with 62 symbols instead of the usual 10 (decimal) or 16 (hex).
//   Symbols: 0-9 (10) + a-z (26) + A-Z (26) = 62 total
//
// WHY BASE62 FOR SHORT CODES?
//   - URL-safe: no special characters like +, / that Base64 uses
//   - Human-readable: easy to type and share
//   - Compact: 7 chars = 62^7 = 3.5 TRILLION unique codes
//   - Collision-free: derived from the DB auto-increment ID (always unique)
//
// HOW ENCODING WORKS (just like converting decimal to another base):
//   Decimal 125 in base 10:  1×100 + 2×10 + 5×1
//   Decimal 125 in base 62:  2×62  + 1×1   → "21" in Base62
//
//   Algorithm: repeatedly divide by 62, collect remainders, read them bottom-up
// ─────────────────────────────────────────────────────────────────────────────

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
//               ←── 10 ──→ ←──────────────── 26 ──────────────→ ←───── 26 ─────→
//                                          62 total

/**
 * Encode a positive integer to a Base62 string.
 * @param {number} id - A positive integer (the DB auto-increment id)
 * @returns {string} - Base62 encoded string
 *
 * Example: encode(1)   → "1"
 *          encode(61)  → "Z"
 *          encode(62)  → "10"
 *          encode(3521) → "ZP"
 */
function encode(id) {
  if (id === 0) return ALPHABET[0]; // Edge case: 0 encodes to "0"

  let result = '';
  let num = id;

  while (num > 0) {
    // Get the remainder when dividing by 62
    // This remainder is the "digit" at the current position
    const remainder = num % 62;
    result = ALPHABET[remainder] + result; // Prepend (read remainders bottom-up)
    num = Math.floor(num / 62);           // Move to next "digit"
  }

  return result;
}

/**
 * Decode a Base62 string back to an integer.
 * Used to look up the original DB row if needed.
 * @param {string} code - A Base62 encoded string
 * @returns {number} - The original integer
 *
 * Example: decode("ZP") → 3521
 */
function decode(code) {
  let result = 0;

  for (const char of code) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base62 character: ${char}`);
    // Horner's method: process left to right, multiply existing by 62, add new digit
    result = result * 62 + index;
  }

  return result;
}

module.exports = { encode, decode };
