# Code Analysis Report — `flatkv`

**Date:** 2026-03-23
**Target:** `src/flatKV.ts`, `src/flatKV.test.ts`

---

## 1. Code Organization and Structure

The project is a small TypeScript utility library with a minimal footprint:

- **`src/flatKV.ts`** (147 lines) — single source file containing all types and functions
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

`Flat<T>` is used internally as the return type of `makeFlat` but is **not exported**.

---

## 2. Relations of Implementations — Types and Interfaces

```
KV<T>
  └─ { [key: string]: T | T[] | KV<T> }   (recursive union)

IsValue<T>
  └─ (x: KV<T> | T | T[]) => x is T       (user-provided type guard)

Flat<T>  [unexported]
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

**Delimiter:** Defaults to `':'`. There is no escaping mechanism — if a key itself contains the delimiter character, `revertFlat(makeFlat(kv))` will produce an incorrect result (key splitting will be wrong).

**Immutability:** `kvGet` and `kvUpdate` are purely functional — they do not mutate inputs. `kvUpdate` uses object spread (`{ ...obj }`) to create shallow copies at each level of the path.

---

## 5. Pitfalls

### P1 — Silent data loss in `makeFlat` for array values

In `dig()` (`flatKV.ts:101–123`):
```ts
} else {           // not a KV object
  if (isValue(next)) {
    flats.push({ flatKey: key, value: next });
  }
  // else: silently dropped!
}
```
If `next` is a `T[]` and `isValue` does not return `true` for arrays (e.g., when `T` is `string` and values include `string[]`), the array entry is **silently dropped** from the flat output. There is no error or warning. This means `revertFlat(makeFlat(kv, isValue))` may not reproduce the original `kv`.

### P2 — Delimiter collision in keys

There is no escaping for the delimiter character in key names. If any key string contains `':'` (or whatever delimiter is used), `revertFlat` will split that key incorrectly, producing a wrong nested structure.

```ts
// Example — produces wrong revert result
const kv: KV<string> = { 'a:b': 'value' };
const flat = makeFlat(kv, isValue);         // { 'a:b': 'value' }
const reverted = revertFlat(flat, isValue); // { a: { b: 'value' } } ← WRONG
```

### P3 — `kvUpdate` throws without message (`flatKV.ts:68`)

```ts
if (!isKv(prevKv) || isValue(prevKv) || Array.isArray(prevKv[prevKey])) {
  throw new Error();
}
```
An unconditional `new Error()` with no message is thrown when an inconsistent internal state is detected during reconstruction. This makes debugging impossible without source-level tracing.

### P4 — `revertFlat` dead code branch (`flatKV.ts:141`)

`kvUpdate` called without `updateIffExists = true` never returns `undefined` (it always creates paths). The `else { return undefined }` branch in `revertFlat` is unreachable under normal usage:

```ts
if (kv !== undefined) {
  kv = kvUpdate(kv, flatKey.split(delimiter), value, isValue);
} else {
  return undefined; // ← unreachable in practice
}
```

### P5 — Typo in parameter name (`flatKV.ts:35`)

```ts
updateIffExits: boolean = false   // "Exits" should be "Exists"
```

### P6 — `isKv` type guard triggers false-positive for object-typed `T`

When `T` is itself an object type (not a primitive), `isKv(value)` returns `true` for any plain object — including leaf values of type `T`. The library relies on `isValue` being called after `isKv` in the right order to disambiguate, but this ordering is fragile and not enforced by the type system.

---

## 6. Improvement Points — Design Overview

**I. Formalize the round-trip guarantee.**
`makeFlat` and `revertFlat` are inverse operations, but this is not guaranteed to be lossless (see P1, P2). A documented contract or a `roundTrip(kv, isValue, delimiter)` test helper would clarify under which conditions the round-trip holds.

**II. Reconsider `scope` semantics.**
The `scope` parameter in `makeFlat` acts as a global key whitelist applied at every depth, which is non-obvious. Consider renaming it (`keyWhitelist`, `allowedKeys`) or redesigning it to operate only at the root level (scoping top-level namespaces).

**III. Delimiter safety.**
Either document that keys must not contain the delimiter character, or provide an escape/encode mechanism. Alternatively, accept an explicit encoding function instead of a raw delimiter string.

**IV. Consider a "codec" pattern.**
Pairing `makeFlat`/`revertFlat` into a `FlatKVCodec` object with explicit encode/decode methods would make the relationship clearer and allow configuration (delimiter, isValue) to be set once rather than passed at every call site.

---

## 7. Improvement Points — Types and Interfaces

**I. Export `Flat<T>`.**
`Flat<T>` is the return type of `makeFlat` but is not exported. Users who want to type variables holding flat results must use `ReturnType<typeof makeFlat>` or `Record<string, T>`.

**II. `IsValue<T>` should clarify its responsibility toward arrays.**
The type `(x: KV<T> | T | T[]) => x is T` accepts `T[]` as input but asserts `T`. For the common case of `T = string[]`, the guard input would include `string[][]`. Consider a separate `IsValueArray<T>` or a union guard `(x) => x is T | T[]`.

**III. `KV<T>` could be narrowed at the type level.**
The type currently allows `null` to be assignable as `T`. Adding `T extends NonNullable<unknown>` constraint would prevent a class of runtime bugs since `isKv` explicitly rejects `null`.

**IV. `kvUpdate` return type is `KV<T> | undefined`.**
Overloaded signatures could encode the `updateIffExists` flag in the type, making the return type `KV<T>` when `updateIffExists = false` and `KV<T> | undefined` when `true`.

---

## 8. Improvement Points — Implementations

**I. `kvUpdate` forward traversal doesn't advance `partial` for missing keys.**
When a key is not found (lines `flatKV.ts:48–54`), `partials` receives a placeholder `{ [key]: {} }` but `partial` is not advanced. This means all subsequent missing-key iterations push new placeholders while `partial` stays at the last found node. This happens to produce correct results because the rebuild loop merges placeholders correctly via `{ ...undefined }` spread, but the implementation is very hard to reason about. The forward pass logic should be made explicit.

**II. `kvUpdate` rebuild loop is complex — consider recursion.**
The backward reconstruction loop (`flatKV.ts:58–80`) manages index arithmetic, edge cases for `i - 1 < 0`, and three separate spread branches for value vs array vs KV. A recursive implementation would naturally express the same logic with clearer termination conditions.

**III. `exists` checks only `undefined`, not `null` (`flatKV.ts:9–11`).**
If `null` is stored as a value in a `KV<T>` (which is possible when `T` extends `null | ...`), `exists` would return `true` and `isKv` would return `false`, causing the value to be treated as a non-KV, non-existent node in `kvGet`. This is an edge case but worth documenting or guarding.

**IV. `throw new Error()` should include diagnostic context (`flatKV.ts:68`).**
At minimum, the error should include the key path and the problematic value type.

**V. Duplicate shallow copy of `kv` at the start of `kvUpdate` (`flatKV.ts:37–38`).**
```ts
const partials: (KV<T> | T | T[])[] = [{ ...kv }];
let partial: KV<T> | T | T[] = { ...kv };
```
Two spread copies of `kv` are made. `partials[0]` is used in the merge step at `i - 1 < 0`; `partial` is used for traversal. Only one copy is needed if the logic were restructured.

---

## 9. Learning Paths on Implementations

### Entry: `kvGet` — simplest function
- Start at `flatKV.ts:13`. Understand how `isKv` and `exists` cooperate to safely traverse the tree.
- Note: the initial spread `{ ...kv }` is unnecessary since `kvGet` never mutates.

### Entry: `makeFlat` — recursive flattening
- Start at `flatKV.ts:88`. Follow the `dig` inner function.
- Understand why `isValue` must be passed: the library cannot infer what constitutes a leaf.
- Observe how `scope` works as a closure-captured global filter.
- Trace `revertFlat` (`flatKV.ts:132`) to see how it rebuilds the tree via `kvUpdate`.

### Entry: `kvUpdate` — core mutation logic (most complex)
- Start at `flatKV.ts:30`.
- Phase 1 (forward, lines 40–55): builds up `partials` stack, tracing the path.
- Phase 2 (backward, lines 58–80): reconstructs the new tree from the leaf up to the root.
- Key insight: when a path segment is missing and `updateIffExists = false`, a placeholder `{ [key]: {} }` is pushed, and the rebuild step handles it correctly via spread of `undefined`.
- **Goal:** understand why `partials[i - 1]` at the merge step always refers to the *parent* node snapshot, not the mutated one.

### Goal: understand the round-trip guarantee
- Trace `makeFlat` → `revertFlat` → compare to original `kv`.
- Identify conditions under which the round-trip is **not** lossless: array values where `isValue` returns false, keys containing the delimiter character.
- Review the `revertFlat` test in `flatKV.test.ts:331` for the canonical happy-path example.

---

*Generated by Claude Code (claude-sonnet-4-6) on 2026-03-23.*
