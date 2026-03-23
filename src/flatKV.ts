export type KV<T> = {
  [key in string]: T | T[] | KV<T>;
};

function isKv<T>(value: KV<T> | T | T[]): value is KV<T> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exists<T>(value: KV<T> | T | T[]): boolean {
  return value !== undefined;
}

export function kvGet<T>(
  kv: KV<T>,
  keys: string[]
): T | KV<T> | T[] | undefined {
  let target: KV<T> | T | T[] = { ...kv };
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

export function kvUpdate<T>(
  kv: KV<T>,
  keys: string[],
  value: T | T[] | KV<T>,
  isValue: IsValue<T>,
  updateIffExits: boolean = false
): KV<T> | undefined {
  const partials: (KV<T> | T | T[])[] = [{ ...kv }];
  let partial: KV<T> | T | T[] = { ...kv };

  for (const key of keys) {
    if (isKv(partial) && exists(partial[key])) {
      if (isValue(partial[key]) || Array.isArray(partial[key])) {
        partials.push(partial[key]);
      } else {
        partials.push({ ...partial[key] });
      }
      partial = partial[key];
    } else {
      if (updateIffExits) {
        return undefined;
      } else {
        partials.push({ [key]: {} });
      }
    }
  }
  let newKv: KV<T> = { [keys[keys.length - 1]]: value }; // last one

  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    const prevKey = keys[i - 1];
    const prevKv = partials[i - 1];

    // prevKv === undefined
    if (i - 1 < 0) {
      newKv = { ...kv, ...newKv };
    } else {
      if (!isKv(prevKv) || isValue(prevKv) || Array.isArray(prevKv[prevKey])) {
        throw new Error();
      }

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

type Flat<T> = {
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
): KV<T> | undefined {
  let kv: KV<T> | undefined = {};
  for (const [flatKey, value] of Object.entries(flat)) {
    if (kv !== undefined) {
      kv = kvUpdate(kv, flatKey.split(delimiter), value, isValue);
    } else {
      return undefined;
    }
  }
  return kv;
}
