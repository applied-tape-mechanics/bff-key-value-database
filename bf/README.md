# Brainfuck Programs — `bf/`

This directory contains the Brainfuck source programs used by the KV database
engine.

## `hash.bf` — Key Hashing

**Purpose:** Compute a bucket index (0–255) for a given key string.

**Algorithm:** Read key bytes from stdin until a null terminator (`\0`), accumulate
their sum in a single cell. Because Brainfuck cells are 8-bit and wrap at 256,
the final value is automatically `sum(key_bytes) mod 256`.

**Stripped BF code:**
```brainfuck
,[[->+<],]>.
```

**Annotated version:**
```brainfuck
,            Read first key byte into cell 0
[            Outer loop: while byte ≠ 0
  [->+<]       Inner loop: add cell 0 to cell 1 (accumulator); zeros cell 0
  ,            Read next byte into cell 0
]            End outer loop (re-checks cell 0)
>            Move to cell 1 (accumulated hash)
.            Output hash byte
```

**Trace for key `"abc"` (bytes 97, 98, 99, 0):**

| Step | cell[0] | cell[1] | Action                       |
|------|---------|---------|------------------------------|
| 1    | 97      | 0       | Read `'a'`                   |
| 2    | 0       | 97      | Add 97 to accumulator        |
| 3    | 98      | 97      | Read `'b'`                   |
| 4    | 0       | 195     | Add 98                       |
| 5    | 99      | 195     | Read `'c'`                   |
| 6    | 0       | 38      | Add 99 → 294 wraps to 38    |
| 7    | 0       | 38      | Read `\0` → exit loop        |
| 8    | —       | **38**  | Output hash = **38**         |

## Why This Hash?

A cryptographic or polynomial hash would distribute keys more evenly, but those
algorithms require multiplication, division, and multi-byte arithmetic — all
extremely costly in Brainfuck (each multiply is a nested loop, division requires
repeated subtraction). The byte-sum approach is the best trade-off between
**implementability in pure BF** and acceptable distribution for a 256-bucket
table.
