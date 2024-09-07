import {
  onCleanup,
  createRoot,
  untrack,
  createSignal,
  Accessor,
  Setter,
  $TRACK
} from "./signal.js";

const FALLBACK = Symbol("fallback");
function dispose(d: (() => void)[]) {
  for (let i = 0; i < d.length; i++) d[i]();
}

// Modified version of mapSample from S-array[https://github.com/adamhaile/S-array] by Adam Haile
/**
The MIT License (MIT)

Copyright (c) 2017 Adam Haile

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * Reactively transforms an array with a callback function - underlying helper for the `<For>` control flow
 *
 * similar to `Array.prototype.map`, but gets the index as accessor, transforms only values that changed and returns an accessor and reactively tracks changes to the list.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/map-array
 */
export function mapArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: T, i: Accessor<number>) => U,
  options: { fallback?: Accessor<any> } = {}
): () => U[] {
  // 这里的都是一些缓存值，利用闭包实现
  // items 当前缓存的 list 数组备份
  let items: (T | typeof FALLBACK)[] = [],
    // 对应于 items 利用 mapFn 生成的新数组
    mapped: U[] = [],
    // mapped 创建的 createRoot 返回的 clean 函数
    disposers: (() => void)[] = [],
    // 数组长度
    len = 0,
    // 使用 index 时生成，会产生一个 index Signal 供 mapFn 使用
    indexes: ((v: number) => number)[] | null = mapFn.length > 1 ? [] : null;

  onCleanup(() => dispose(disposers));
  return () => {
    // mapArray 本身没有响应式，但是每次都会去读取 list() 拿取最新值
    let newItems = list() || [],
      newLen = newItems.length,
      i: number,
      j: number;
    // 这边做依赖收集，监听 list 变化，然后更新
    (newItems as any)[$TRACK]; // top level tracking
    return untrack(() => {
      let newIndices: Map<T | typeof FALLBACK, number>,
        newIndicesNext: number[],
        temp: U[],
        tempdisposers: (() => void)[],
        tempIndexes: ((v: number) => number)[],
        start: number,
        end: number,
        newEnd: number,
        item: T | typeof FALLBACK;

      // 传来的时空数组的话，直接情况数据，或者是还在请求显示 fallback
      // fast path for empty arrays
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback!();
          });
          len = 1;
        }
      }
      // len === 0 && newLen > 0 情况，说明是第一次加载，或者请求完成后进入，因为首次的时候 len = 0
      // fast path for new create
      else if (len === 0) {
        // 这里创建 mapped 数组
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          // mapper 里会执行 mapFn 方法，而 createRoot 会避免对 mapFn 里的数据产生依赖收集，除非是显示调用，如 list()[i].name()
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        // 这里就算经典的 Diff 算法了，和 Vue 的类型
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));

        //  判断两个数组
        // 先判断 新旧开头
        // skip common prefix
        for (
          start = 0, end = Math.min(len, newLen);
          start < end && items[start] === newItems[start];
          start++
        );

        // 先判断 新旧结尾
        // common suffix
        for (
          end = len - 1, newEnd = newLen - 1;
          end >= start && newEnd >= start && items[end] === newItems[newEnd];
          end--, newEnd--
        ) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes![newEnd] = indexes[end]);
        }

        // 剩下了的为不同的节点
        // 0) prepare a map of all indices in newItems, scanning backwards so we encounter them in natural order
        newIndices = new Map<T, number>();
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item)!;
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }
        // 遍历 旧数组，看 newIndices 是否也有，有说明就是移动，否则就算删除了
        // 1) step through all old items and see if they can be found in the new set; if so, save them in a temp array and mark them moved; if not, exit them
        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item)!;
          if (j !== undefined && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes![j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        // 遍历 新数组，找到移动节点的新位置，如果没有，说明就算创建了
        // 2) set all the new values, pulling from the temp array if copied, otherwise entering the new value
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes![j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        // 3) in case the new set is shorter than the old, set the length of the mapped array
        mapped = mapped.slice(0, (len = newLen));
        // 4) save a copy of the mapped items for the next update
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer: () => void) {
      // 收集 dispose 方法
      disposers[j] = disposer;
      // 如果需要 indexes，则会添加一个 index Signal
      if (indexes) {
        // 这里可以看到，map出来的下标也是响应式的 Signal
        const [s, set] = "_SOLID_DEV_" ? createSignal(j, { name: "index" }) : createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      // 执行 mapFn
      return (mapFn as any)(newItems[j]);
    }
  };
}

/**
 * Reactively maps arrays by index instead of value - underlying helper for the `<Index>` control flow
 *
 * similar to `Array.prototype.map`, but gets the value as an accessor, transforms only changed items of the original arrays anew and returns an accessor.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/index-array
 */
export function indexArray<T, U>(
  list: Accessor<readonly T[] | undefined | null | false>,
  mapFn: (v: Accessor<T>, i: number) => U,
  options: { fallback?: Accessor<any> } = {}
): () => U[] {
  // 首先，得知道 For 和 Index 两个组件的区别，Index 是用于 list 中每个元素位置基本不会变的情况下，所以，它内部不会去做 Diff 比较，因为已经说明了特殊的使用情况
  // 另外，Index 中每一个 item 会对应一个 Signal，也是一种优化，处理的时候，只要针对其中一个 Signal 进行更新即可

  let items: (T | typeof FALLBACK)[] = [],
    mapped: U[] = [],
    disposers: (() => void)[] = [],
    // 这里就是记录每一个 item 对应的 Signal
    signals: Setter<T>[] = [],
    len = 0,
    i: number;

  onCleanup(() => dispose(disposers));
  return () => {
    const newItems = list() || [],
      newLen = newItems.length;
    (newItems as any)[$TRACK]; // top level tracking
    return untrack(() => {
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          signals = [];
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback!();
          });
          len = 1;
        }
        return mapped;
      }
      if (items[0] === FALLBACK) {
        disposers[0]();
        disposers = [];
        items = [];
        mapped = [];
        len = 0;
      }

      for (i = 0; i < newLen; i++) {
        if (i < items.length && items[i] !== newItems[i]) {
          signals[i](() => newItems[i]);
        } else if (i >= items.length) {
          mapped[i] = createRoot(mapper);
        }
      }
      for (; i < items.length; i++) {
        disposers[i]();
      }
      len = signals.length = disposers.length = newLen;
      items = newItems.slice(0);
      return (mapped = mapped.slice(0, len));
    });
    function mapper(disposer: () => void) {
      disposers[i] = disposer;
      // index 会为每一个 item 创建一个 Signal Accessor
      const [s, set] = "_SOLID_DEV_"
        ? createSignal(newItems[i], { name: "value" })
        : createSignal(newItems[i]);
      signals[i] = set;
      return mapFn(s, i);
    }
  };
}
