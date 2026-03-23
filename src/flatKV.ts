export type KV<T> = {
  [key in string]: T | T[] | KV<T>;
};

function isKv<T>(value: KV<T> | T | T[]): value is KV<T> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exists<T>(value: KV<T> | T | T[]): boolean {
  return value !== undefined && value !== null;
}

export function kvGet<T>(
  kv: KV<T>,
  keys: string[]
): T | KV<T> | T[] | undefined {
  let target: KV<T> | T | T[] = kv;
  for (const key of keys) {
    if (isKv(target) && exists(target[key])) {
      target = target[key];
    } else {
      return undefined;
    }
  }
  return target;
}

export type IsValue<T> = (x: KV<T> | T | T[]) => x is T;

type PartialEntry<T> =
  | { isKvNode: true; value: KV<T> }
  | { isKvNode: false; value: T | T[] };

export function kvUpdate<T>(
  kv: KV<T>,
  keys: string[],
  value: T | T[] | KV<T>,
  isValue: IsValue<T>,
  updateIffExists: true
): KV<T> | undefined;
export function kvUpdate<T>(
  kv: KV<T>,
  keys: string[],
  value: T | T[] | KV<T>,
  isValue: IsValue<T>,
  updateIffExists?: false
): KV<T>;
export function kvUpdate<T>(
  kv: KV<T>,
  keys: string[],
  value: T | T[] | KV<T>,
  isValue: IsValue<T>,
  updateIffExists: boolean = false
): KV<T> | undefined {
  const initialValue: KV<T> = { ...kv };
  const partials: PartialEntry<T>[] = [{ isKvNode: true, value: initialValue }];
  let partial: KV<T> | T | T[] = initialValue;

  for (const key of keys) {
    if (isKv(partial) && exists(partial[key])) {
      const child: T | T[] | KV<T> = partial[key];
      if (isValue(child) || Array.isArray(child)) {
        partials.push({ isKvNode: false, value: child as T | T[] });
      } else {
        partials.push({ isKvNode: true, value: { ...(child as KV<T>) } });
      }
      partial = child;
    } else {
      if (updateIffExists) {
        return undefined;
      } else {
        partials.push({ isKvNode: true, value: { [key]: {} } });
      }
    }
  }
  let newKv: KV<T> = { [keys[keys.length - 1]]: value };

  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    const prevKey = keys[i - 1];

    if (i - 1 < 0) {
      newKv = { ...kv, ...newKv };
    } else {
      const prevEntry = partials[i - 1];
      if (!prevEntry.isKvNode || Array.isArray(prevEntry.value[prevKey as keyof typeof prevEntry.value])) {
        throw new Error(
          `kvUpdate: expected a KV node at key "${prevKey}" but found a leaf value. ` +
          `Key path: [${keys.slice(0, i).join(', ')}]`
        );
      }
      const prevKv = prevEntry.value;

      const val = newKv[key];
      if (Array.isArray(val)) {
        newKv = { [prevKey]: { ...prevKv[prevKey], [key]: [...val] } };
      } else if (isKv(val)) {
        newKv = { [prevKey]: { ...prevKv[prevKey], [key]: { ...val } } };
      } else {
        newKv = { [prevKey]: { ...prevKv[prevKey], [key]: val } };
      }
    }
  }
  return newKv;
}

export type Flat<T> = {
  [flatKey in string]: T;
};

export function makeFlat<T>(
  kv: KV<T>,
  isValue: IsValue<T>,
  scope: string[] = [],
  delimiter: string = ':'
): Flat<T> {
  const dig = (
    kv: KV<T>
  ): {
    flatKey: string;
    value: T;
  }[] => {
    let flats: { flatKey: string; value: T }[] = [];
    for (const key of Object.keys(kv)) {
      if (key.includes(delimiter)) {
        throw new Error(
          `makeFlat: key "${key}" contains the delimiter "${delimiter}". ` +
          `Use a different delimiter or rename the key.`
        );
      }
      if (scope.length === 0 || scope.includes(key)) {
        const next = kv[key];
        if (isKv(next)) {
          if (isValue(next)) {
            flats.push({ flatKey: key, value: next });
          } else {
            flats = flats.concat(
              dig(next).map((result) => {
                return {
                  flatKey: `${key}${delimiter}${result.flatKey}`,
                  value: result.value,
                };
              })
            );
          }
        } else {
          if (isValue(next)) {
            flats.push({ flatKey: key, value: next });
          } else if (Array.isArray(next)) {
            throw new Error(
              `makeFlat: array value at key "${key}" is not handled by isValue. ` +
              `Ensure isValue recognizes all leaf types including arrays.`
            );
          }
        }
      }
    }
    return flats;
  };
  const initialFlat: Flat<T> = {};
  return dig(kv).reduce((accumulator, current) => {
    return { ...accumulator, [current.flatKey]: current.value };
  }, initialFlat);
}

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
