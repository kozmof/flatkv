import { expect, test, describe } from 'vitest';
import { type KV, kvGet, kvUpdate, makeFlat, type IsValue, revertFlat } from './flatKV';

describe('kvGet', () => {
  const kv: KV<string> = {
    a: {
      b: {
        d: {
          f: 'test1'
        },
        e: {
          g: 'test2'
        }
      },
      c: 'test3'
    }
  };

  test('Gets correctly', () => {
    expect(kvGet(kv, ['a', 'b', 'd', 'f'])).toEqual('test1');
    expect(kvGet(kv, ['a', 'b', 'd'])).toEqual({
      f: 'test1'
    });
    expect(kvGet(kv, ['a', 'b', 'e', 'g'])).toEqual('test2');
    expect(kvGet(kv, ['a', 'c'])).toEqual('test3');
  });

  test('If the key path does not exist, it returns undefined.', () => {
    expect(kvGet(kv, ['a', 'x'])).toEqual(undefined);
  });
});


describe('kvUpdate', () => {
  describe('Use case of a primitive value type', () => {
    const isValue: IsValue<string> = (val): val is string => {
      return typeof val === 'string';
    };
    test('Update exisiting value️', () => {
      const kv: KV<string> = {
        a: {
          b: {
            d: {
              f: 'test1'
            },
            e: {
              g: 'test2',
              h: 'test3'
            }
          },
          c: 'test4'
        },
        x: 'test5'
      };
      let newKv = kvUpdate(
        kv,
        ['a', 'b', 'd', 'f'],
        'updated',
        isValue
      );
      expect(newKv).toEqual({
        a: {
          b: {
            d: {
              f: 'updated'
            },
            e: {
              g: 'test2',
              h: 'test3'
            }
          },
          c: 'test4'
        },
        x: 'test5'
      });
      newKv = kvUpdate(
        kv,
        ['a', 'b', 'e', 'g'],
        'updated',
        isValue
      );
      expect(newKv).toEqual({
        a: {
          b: {
            d: {
              f: 'test1'
            },
            e: {
              g: 'updated',
              h: 'test3'
            }
          },
          c: 'test4'
        },
        x: 'test5'
      });

      newKv = kvUpdate(
        kv,
        ['x'],
        'updated',
        isValue
      );
      expect(newKv).toEqual({
        a: {
          b: {
            d: {
              f: 'test1'
            },
            e: {
              g: 'test2',
              h: 'test3'
            }
          },
          c: 'test4'
        },
        x: 'updated'
      });
    });
    test('Add a value️', () => {
      const kv: KV<string> = {
        a: {
          b: {
            d: {
              f: 'test1'
            },
            e: {
              g: 'test2',
              h: 'test3'
            }
          },
          c: 'test4'
        },
        x: 'test5'
      };
      const newKv = kvUpdate(
        kv,
        ['a', 'b', 'i', 'j', 'k'],
        'added',
        isValue
      );
      expect(newKv).toEqual({
        a: {
          b: {
            d: {
              f: 'test1'
            },
            e: {
              g: 'test2',
              h: 'test3'
            },
            i: { j: { k: 'added' } },
          },
          c: 'test4'
        },
        x: 'test5'
      });
    });
    test('Prohibit adding a new value, if updateIffExists is true.️', () => {
      const kv: KV<string> = {
        a: {
          b: {
            d: {
              f: 'test1'
            },
            e: {
              g: 'test2',
              h: 'test3'
            }
          },
          c: 'test4'
        },
        x: 'test5'
      };
      const newKv = kvUpdate(
        kv,
        ['a', 'b', 'i', 'j', 'k'],
        'added',
        isValue,
        true
      );
      expect(newKv).toEqual(undefined);
    });
  });

  describe('Use case of an array type', () => {
    test('Update an exisiting value️', () => {
      const isValue: IsValue<string[]> = (val): val is string[] => {
        return Array.isArray(val);
      };
      const kv: KV<string[]> = {
        a: {
          b: {
            d: {
              f: ['test1', 'testA']
            },
            e: {
              g: ['test2', 'testB'],
              h: ['test3', 'testC']
            }
          },
          c: ['test4', 'testD']
        },
        x: ['test5', 'testE']
      };
      const newKv = kvUpdate(
        kv,
        ['a', 'b', 'd', 'f'],
        ['updated1', 'updated2'],
        isValue
      );
      expect(newKv).toEqual({
        a: {
          b: {
            d: {
              f: ['updated1', 'updated2']
            },
            e: {
              g: ['test2', 'testB'],
              h: ['test3', 'testC']
            }
          },
          c: ['test4', 'testD']
        },
        x: ['test5', 'testE']
      });
    });
  });

  describe('Use case of an object type', () => {
    test('Update an existing value️', () => {
      const isValue: IsValue<{tag: string, isTested: boolean }> = (val): val is { tag: string, isTested: boolean } => {
        return 'tag' in val && val.tag === 'test';
      };
      const kv: KV<{ tag: string, isTested: boolean }> = {
        a: {
          b: {
            d: {
              f: { tag: 'test', isTested: false }
            },
            e: {
              g: { tag: 'test', isTested: false },
              h: { tag: 'test', isTested: false }
            }
          },
          c: { tag: 'test', isTested: false }
        },
        x: { tag: 'test', isTested: false }
      };
      const newKv = kvUpdate(
        kv,
        ['a', 'b', 'd', 'f'],
        { tag: 'test', isTested: true },
        isValue
      );
      expect(newKv).toEqual({
        a: {
          b: {
            d: {
              f: { tag: 'test', isTested: true }
            },
            e: {
              g: { tag: 'test', isTested: false },
              h: { tag: 'test', isTested: false }
            }
          },
          c: { tag: 'test', isTested: false }
        },
        x: { tag: 'test', isTested: false }
      });
    });
  });
});

describe('makeFlat', () => {
  test('flatting️', () => {
    const isValue: IsValue<string> = (val): val is string => {
      return typeof val === 'string';
    };
    const kv: KV<string> = {
      a: {
        b: {
          d: {
            f: 'test1'
          },
          e: {
            g: 'test2',
            h: 'test3'
          }
        },
        c: 'test4'
      },
      x: 'test5'
    };
    expect(makeFlat(kv, isValue)).toEqual({
      'a:b:d:f': 'test1',
      'a:b:e:g': 'test2',
      'a:b:e:h': 'test3',
      'a:c': 'test4',
      x: 'test5'
    });
  });

  test('scoping️', () => {
    const isValue: IsValue<string> = (val): val is string => {
      return typeof val === 'string';
    };
    const kv: KV<string> = {
      a: {
        b: {
          d: {
            f: 'test1'
          },
          e: {
            g: 'test2',
            h: 'test3'
          }
        },
        c: 'test4'
      },
      x: 'test5'
    };
    expect(makeFlat(kv, isValue, ['a', 'b', 'd', 'f', 'e', 'g', 'x'])).toEqual({
      'a:b:d:f': 'test1',
      'a:b:e:g': 'test2',
      x: 'test5'
    });
  });
});

describe('revertFlat', () => {
  test('revert️', () => {
    const isValue: IsValue<string> = (val): val is string => {
      return typeof val === 'string';
    };
    const flat = {
      'a:b:d:f': 'test1',
      'a:b:e:g': 'test2',
      'a:b:e:h': 'test3',
      'a:c': 'test4',
      x: 'test5'
    };
    expect(revertFlat(flat, isValue)).toEqual({
      a: {
        b: {
          d: {
            f: 'test1'
          },
          e: {
            g: 'test2',
            h: 'test3'
          }
        },
        c: 'test4'
      },
      x: 'test5'
    });
  });
});
