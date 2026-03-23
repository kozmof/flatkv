# Code Analysis Report — `flatkv`

**Date:** 2026-03-23
**Target:** `src/flatKV.ts`, `src/flatKV.test.ts`
**Last updated:** 2026-03-24 (applied fixes 7.I, 7.IV, 8.III, 8.V, kvGet spread; investigated 7.III)

---

## 1. Code Organization and Structure

The project is a small TypeScript utility library with a minimal footprint:

- **`src/flatKV.ts`** (163 lines) — single source file containing all types and functions
- **`src/flatKV.test.ts`** (360 lines) — Vitest test suite
- **`package.json`** — only defines a `test` script; no build pipeline configured
- No index/barrel file, no build output, no `tsconfig.json` found at root

The library provides four primary operations on nested key-value structures:

| Export | Kind | Role |
|--------|------|------|
| `KV<T>` | Type | Recursive nested object type |
| `IsValue<T>` | Type | User-supplied type guard (leaf discriminator) |
| `kvGet` | Function | Read value at key path |
| `kvUpdate` | Function | Immutable update at key path |
| `makeFlat` | Function | Flatten nested KV to `delimiter`-joined string keys |
| `revertFlat` | Function | Reconstruct nested KV from flat representation |

`Flat<T>` is the return type of `makeFlat` and is **exported**.

---

## 2. Relations of Implementations — Types and Interfaces

```
KV<T>
  └─ { [key: string]: T | T[] | KV<T> }   (recursive union)

IsValue<T>
  └─ (x: KV<T> | T | T[]) => x is T       (user-provided type guard)

PartialEntry<T>  [private, used inside kvUpdate]
  └─ { isKvNode: true;  value: KV<T>    }
   | { isKvNode: false; value: T | T[]  }

Flat<T>  [exported]
  └─ { [key: string]: T }                  (leaf-only, flat keys)
```

**Key design tension:** `T` can be any type, including objects. Because `KV<T>` and `T` may both be plain objects, the library cannot intrinsically distinguish a "leaf value" from a "nested branch." This is why `IsValue<T>` must be provided by the caller everywhere — it is the central design invariant the library depends on.

**Array handling:** `KV<T>` includes `T[]` as a valid value, meaning arrays are treated as leaf-like data. However, `IsValue<T>` returns `x is T`, not `x is T | T[]`. Arrays receive special treatment in `kvUpdate` via `Array.isArray()` checks, separate from the `isValue` guard.

---

## 3. Relations of Implementations — Functions

```
makeFlat  ──────────────────────────┐
  └─ calls: isKv, isValue (guard)   │ round-trip
revertFlat ─────────────────────────┘
  └─ calls: kvUpdate

kvUpdate
  └─ calls: isKv, exists, isValue (guard)

kvGet
  └─ calls: isKv, exists

isKv  [private type guard]
exists  [private existence check]
```

`revertFlat` is implemented as repeated `kvUpdate` calls — one per flat key-value pair. This creates a dependency chain where the correctness of `revertFlat` inherits all the edge cases of `kvUpdate`.

---

## 4. Specific Contexts and Usages

**`IsValue<T>` contract:** Callers must supply a type guard that returns `true` for leaf values and `false` for KV subtrees. For primitive `T` (e.g., `string`), this is `typeof val === 'string'`. For object-typed `T`, the guard must use a discriminant property (as shown in the test: `'tag' in val && val.tag === 'test'`).

**`makeFlat` scope parameter:** `scope` is a string array that acts as a global key whitelist applied at **every depth level** of traversal (via closure capture). This is subtle — it is not a root-level namespace filter. Any key at any depth that is not in `scope` will be excluded. For example, passing `scope = ['a', 'x']` would include `a:b:...` paths only if `b` is also in scope.

**Delimiter:** Defaults to `':'`. Keys containing the delimiter character now cause `makeFlat` to throw immediately (see P2 fix). The round-trip `revertFlat(makeFlat(kv))` is guaranteed to be correct as long as no key contains the delimiter.

**Immutability:** `kvGet` and `kvUpdate` are purely functional — they do not mutate inputs. `kvUpdate` uses object spread (`{ ...obj }`) to create shallow copies at each level of the path.

---

## 5. Pitfalls

All six pitfalls identified in the initial analysis have been fixed.

### P1 — ~~Silent data loss in `makeFlat` for array values~~ ✅ Fixed

**Was:** In the `dig` inner function, if `next` is a `T[]` and `isValue` does not return `true` for it, the array entry was silently dropped with no error.

**Fix (`flatKV.ts:142–148`):** Added an `else if (Array.isArray(next))` branch that throws with a descriptive message:
```ts
} else if (Array.isArray(next)) {
  throw new Error(
    `makeFlat: array value at key "${key}" is not handled by isValue. ` +
    `Ensure isValue recognizes all leaf types including arrays.`
  );
}
```

---

### P2 — ~~Delimiter collision in keys~~ ✅ Fixed

**Was:** Keys containing the delimiter character (`':'` by default) would corrupt flat key strings, making `revertFlat` produce wrong nested structures with no error.

**Fix (`flatKV.ts:118–123`):** Added a guard at the top of the `dig` loop that throws if any key contains the delimiter:
```ts
if (key.includes(delimiter)) {
  throw new Error(
    `makeFlat: key "${key}" contains the delimiter "${delimiter}". ` +
    `Use a different delimiter or rename the key.`
  );
}
```

---

### P3 — ~~`kvUpdate` throws without message~~ ✅ Fixed

**Was:** `throw new Error()` with no message made the error impossible to diagnose.

**Fix (`flatKV.ts:78–81`):** The throw now includes the offending key and the full traversed key path:
```ts
throw new Error(
  `kvUpdate: expected a KV node at key "${prevKey}" but found a leaf value. ` +
  `Key path: [${keys.slice(0, i).join(', ')}]`
);
```

---

### P4 — ~~`revertFlat` dead code branch~~ ✅ Fixed (further improved 2026-03-24)

**Was:** The loop structure checked `if (kv !== undefined)` before calling `kvUpdate`, with an unreachable `else { return undefined }` because `kvUpdate` without `updateIffExists=true` never returns `undefined`.

**Fix (2026-03-23, `flatKV.ts:169–174`):** Restructured to call `kvUpdate`, check its result explicitly, then assign:
```ts
let kv: KV<T> = {};
for (const [flatKey, value] of Object.entries(flat)) {
  const next = kvUpdate(kv, flatKey.split(delimiter), value, isValue);
  if (next === undefined) return undefined;
  kv = next;
}
```

**Further improvement (2026-03-24):** After adding overloaded signatures to `kvUpdate` (see 7.IV fix), the `if (next === undefined) return undefined` check became statically dead code — TypeScript now knows `kvUpdate` called without `updateIffExists` always returns `KV<T>`. The intermediate `next` variable was removed and `revertFlat`'s return type simplified from `KV<T> | undefined` to `KV<T>` (`flatKV.ts:153–163`):
```ts
export function revertFlat<T>(
  flat: Flat<T>,
  isValue: IsValue<T>,
  delimiter: string = ':'
): KV<T> {
  let kv: KV<T> = {};
  for (const [flatKey, value] of Object.entries(flat)) {
    kv = kvUpdate(kv, flatKey.split(delimiter), value, isValue);
  }
  return kv;
}
```

---

### P5 — ~~Typo `updateIffExits`~~ ✅ Fixed

**Was:** Parameter name `updateIffExits` (typo: "Exits").

**Fix (`flatKV.ts:42, 57`):** Renamed to `updateIffExists` at the parameter declaration and its usage inside the function body.

---

### P6 — ~~`isValue(prevKv)` false-positive for object-typed `T`~~ ✅ Fixed

**Was:** In `kvUpdate`'s rebuild loop, the guard `isValue(prevKv)` was used to detect whether a `partials` entry was a leaf value instead of a KV node. When `T` is an object type, this could false-positive: a legitimate KV subtree that happens to satisfy `isValue` would cause the function to throw incorrectly.

**Fix (`flatKV.ts:33–35, 44, 50–53, 73–77`):** Introduced the private `PartialEntry<T>` tagged union. The forward traversal now explicitly tags each `partials` entry as `isKvNode: true` or `isKvNode: false` at the point it is pushed. The rebuild loop checks `prevEntry.isKvNode` directly instead of re-running `isValue`:
```ts
type PartialEntry<T> =
  | { isKvNode: true;  value: KV<T>   }
  | { isKvNode: false; value: T | T[] };
```
```ts
// forward loop — tagging on push
if (isValue(child) || Array.isArray(child)) {
  partials.push({ isKvNode: false, value: child as T | T[] });
} else {
  partials.push({ isKvNode: true, value: { ...(child as KV<T>) } });
}
```
```ts
// rebuild loop — flag-based check, no isValue call
if (!prevEntry.isKvNode || Array.isArray(prevEntry.value[prevKey ...])) {
  throw new Error(...);
}
```

---

## 6. Improvement Points — Design Overview

**I. Formalize the round-trip guarantee.**
`makeFlat` and `revertFlat` are inverse operations. With P1 and P2 fixed, the round-trip is now fail-fast rather than silently lossy, but it is still not guaranteed lossless for all inputs. A documented contract or a `roundTrip(kv, isValue, delimiter)` test helper would clarify the exact preconditions.

**II. Reconsider `scope` semantics.**
The `scope` parameter in `makeFlat` acts as a global key whitelist applied at every depth, which is non-obvious. Consider renaming it (`keyWhitelist`, `allowedKeys`) or redesigning it to operate only at the root level (scoping top-level namespaces).

**III. ~~Delimiter safety.~~** ✅ Addressed by P2 fix — `makeFlat` now throws on key/delimiter collision.

**IV. Consider a "codec" pattern.**
Pairing `makeFlat`/`revertFlat` into a `FlatKVCodec` object with explicit encode/decode methods would make the relationship clearer and allow configuration (delimiter, isValue) to be set once rather than passed at every call site.

---

## 7. Improvement Points — Types and Interfaces

**I. ~~Export `Flat<T>`.~~** ✅ Fixed
`Flat<T>` is now exported (`flatKV.ts:102`). Users can import it directly to type flat-keyed result variables.

**II. `IsValue<T>` should clarify its responsibility toward arrays.**
The type `(x: KV<T> | T | T[]) => x is T` accepts `T[]` as input but asserts `T`. For the common case of `T = string[]`, the guard input would include `string[][]`. Consider a separate `IsValueArray<T>` or a union guard `(x) => x is T | T[]`.

**III. `KV<T>` could be narrowed at the type level.** ⚠️ Investigated — not applied
Adding `T extends NonNullable<unknown>` to `KV<T>` (and propagating it to all generic functions) was attempted but rejected: because `T extends {}` makes `T` a potentially object-shaped type, TypeScript's type narrowing inside `isKv` guards breaks — after `isKv(target)` is true, TypeScript no longer fully excludes `T` from the narrowed type (since `T` could overlap with `KV<T>`), resulting in errors like "can't be used to index type `T | KV<T>`". The runtime protection is partially covered by the `exists` null fix (see 8.III). This constraint would require re-architecting `isKv` (e.g., accepting `unknown` as input) before it becomes viable.

**IV. ~~`kvUpdate` return type is `KV<T> | undefined`.~~** ✅ Fixed
Two overload signatures now encode the `updateIffExists` flag in the return type (`flatKV.ts:35–47`):
```ts
export function kvUpdate<T>(..., updateIffExists: true): KV<T> | undefined;
export function kvUpdate<T>(..., updateIffExists?: false): KV<T>;
```
Callers that omit or pass `false` get `KV<T>` (no narrowing needed at call sites); callers that pass `true` get `KV<T> | undefined`. This also enabled the `revertFlat` return type simplification (see P4).

---

## 8. Improvement Points — Implementations

**I. `kvUpdate` forward traversal doesn't advance `partial` for missing keys.**
When a key is not found (`flatKV.ts:56–62`), `partials` receives a placeholder `{ isKvNode: true, value: { [key]: {} } }` but `partial` is not advanced. This means all subsequent missing-key iterations push new placeholders while `partial` stays at the last found node. This happens to produce correct results because the rebuild loop merges placeholders correctly via `{ ...undefined }` spread, but the implementation is hard to reason about. The forward pass logic should be made explicit.

**II. `kvUpdate` rebuild loop is complex — consider recursion.**
The backward reconstruction loop (`flatKV.ts:66–94`) manages index arithmetic, edge cases for `i - 1 < 0`, and three separate spread branches for value vs array vs KV. A recursive implementation would naturally express the same logic with clearer termination conditions.

**III. ~~`exists` checks only `undefined`, not `null`.~~** ✅ Fixed
`exists` now returns `value !== undefined && value !== null` (`flatKV.ts:10`). A `null` value stored in a `KV<T>` is now correctly treated as absent, consistent with how `isKv` already rejects `null`.

**IV. ~~`throw new Error()` should include diagnostic context.~~** ✅ Addressed by P3 fix.

**V. ~~Duplicate shallow copy of `kv` at the start of `kvUpdate`.~~** ✅ Fixed
The two `{ ...kv }` spreads were collapsed into one via a named intermediate (`flatKV.ts:53–55`):
```ts
const initialValue: KV<T> = { ...kv };
const partials: PartialEntry<T>[] = [{ isKvNode: true, value: initialValue }];
let partial: KV<T> | T | T[] = initialValue;
```
`partials[0].value` and `partial` now reference the same object. `kv` is copied exactly once.

---

## 9. Learning Paths on Implementations

### Entry: `kvGet` — simplest function
- Start at `flatKV.ts:13`. Understand how `isKv` and `exists` cooperate to safely traverse the tree.
- The initial `{ ...kv }` spread was removed; `target` is initialized directly to `kv` since `kvGet` never mutates.

### Entry: `makeFlat` — recursive flattening
- Start at `flatKV.ts:107`. Follow the `dig` inner function.
- Understand why `isValue` must be passed: the library cannot infer what constitutes a leaf.
- Note the delimiter guard (P2 fix) at line 110 and the array guard (P1 fix) at line 134.
- Observe how `scope` works as a closure-captured global filter.
- Trace `revertFlat` (`flatKV.ts:153`) to see how it rebuilds the tree via `kvUpdate`.

### Entry: `kvUpdate` — core mutation logic (most complex)
- Start at `flatKV.ts:35`. The first two signatures (lines 35–47) are overloads; the implementation begins at line 48.
- Phase 1 (forward, lines 57–70): builds up the `PartialEntry<T>[]` stack, tagging each entry as KV node or leaf.
- Phase 2 (backward, lines 73–99): reconstructs the new tree from the leaf up to the root.
- Key insight: when a path segment is missing and `updateIffExists = false`, a placeholder `{ isKvNode: true, value: { [key]: {} } }` is pushed, and the rebuild step handles it correctly via `{ ...undefined }` spread.
- **Goal:** understand why the `isKvNode` tag (P6 fix) is necessary when `T` is an object type.

### Goal: understand the round-trip guarantee
- Trace `makeFlat` → `revertFlat` → compare to original `kv`.
- The round-trip is lossless when: all leaf values satisfy `isValue`, and no key contains the delimiter.
- With the P1 and P2 fixes in place, violations of these preconditions now throw rather than silently corrupt data.
- Review the `revertFlat` test in `flatKV.test.ts:331` for the canonical happy-path example.

---

*Generated by Claude Code (claude-sonnet-4-6) on 2026-03-23. Updated 2026-03-24.*
