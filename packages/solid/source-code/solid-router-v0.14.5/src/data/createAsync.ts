/**
 * This is mock of the eventual Solid 2.0 primitive. It is not fully featured.
 */
import { type Accessor, createResource, sharedConfig, type Setter, untrack } from 'solid-js'
import { createStore, reconcile, type ReconcileOptions, unwrap } from 'solid-js/store'
import { isServer } from 'solid-js/web'

/**
 * As `createAsync` and `createAsyncStore` are wrappers for `createResource`,
 * this type allows to support `latest` field for these primitives.
 * It will be removed in the future.
 */
export type AccessorWithLatest<T> = {
  (): T
  latest: T
}

export function createAsync<T>(
  fn: (prev: T) => Promise<T>,
  options: {
    name?: string
    initialValue: T
    deferStream?: boolean
  },
): AccessorWithLatest<T>
export function createAsync<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options?: {
    name?: string
    initialValue?: T
    deferStream?: boolean
  },
): AccessorWithLatest<T | undefined>
export function createAsync<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options?: {
    name?: string
    initialValue?: T
    deferStream?: boolean
  },
): AccessorWithLatest<T | undefined> {
  let resource: () => T
  let prev = () => (!resource || (resource as any).state === 'unresolved' ? undefined : (resource as any).latest)
  // 内部就是使用 createResource 创建一个资源
  ;[resource] = createResource(
    () => subFetch(fn, untrack(prev)),
    v => v,
    options as any,
  )

  const resultAccessor: AccessorWithLatest<T> = (() => resource()) as any
  Object.defineProperty(resultAccessor, 'latest', {
    get() {
      return (resource as any).latest
    },
  })

  return resultAccessor
}

export function createAsyncStore<T>(
  fn: (prev: T) => Promise<T>,
  options: {
    name?: string
    initialValue: T
    deferStream?: boolean
    reconcile?: ReconcileOptions
  },
): AccessorWithLatest<T>
export function createAsyncStore<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options?: {
    name?: string
    initialValue?: T
    deferStream?: boolean
    reconcile?: ReconcileOptions
  },
): AccessorWithLatest<T | undefined>
export function createAsyncStore<T>(
  fn: (prev: T | undefined) => Promise<T>,
  options: {
    name?: string
    initialValue?: T
    deferStream?: boolean
    reconcile?: ReconcileOptions
  } = {},
): AccessorWithLatest<T | undefined> {
  let resource: () => T
  let prev = () =>
    !resource || (resource as any).state === 'unresolved' ? undefined : unwrap((resource as any).latest)
  ;[resource] = createResource(
    () => subFetch(fn, untrack(prev)),
    v => v,
    {
      ...options,
      // 利用 storage 去存储数据
      storage: (init: T | undefined) => createDeepSignal(init, options.reconcile),
    } as any,
  )

  const resultAccessor: AccessorWithLatest<T> = (() => resource()) as any
  Object.defineProperty(resultAccessor, 'latest', {
    get() {
      return (resource as any).latest
    },
  })

  return resultAccessor
}

/**
 * 将 createStore 转换成一种 createSignal 的变体
 */
function createDeepSignal<T>(value: T | undefined, options?: ReconcileOptions) {
  const [store, setStore] = createStore({
    value: structuredClone(value),
  })
  return [
    () => store.value,
    (v: T) => {
      typeof v === 'function' && (v = v())
      setStore('value', reconcile(structuredClone(v), options))
      return store.value
    },
  ] as [Accessor<T | null>, Setter<T | null>]
}

// mock promise while hydrating to prevent fetching
class MockPromise {
  static all() {
    return new MockPromise()
  }
  static allSettled() {
    return new MockPromise()
  }
  static any() {
    return new MockPromise()
  }
  static race() {
    return new MockPromise()
  }
  static reject() {
    return new MockPromise()
  }
  static resolve() {
    return new MockPromise()
  }
  catch() {
    return new MockPromise()
  }
  then() {
    return new MockPromise()
  }
  finally() {
    return new MockPromise()
  }
}

function subFetch<T>(fn: (prev: T | undefined) => Promise<T>, prev: T | undefined) {
  // 正常直接走
  if (isServer || !sharedConfig.context) return fn(prev)

  // 服务端的话，替换 fetch 和 Promise，阻止请求
  const ogFetch = fetch
  const ogPromise = Promise
  try {
    window.fetch = () => new MockPromise() as any
    Promise = MockPromise as any
    return fn(prev)
  } finally {
    window.fetch = ogFetch
    Promise = ogPromise
  }
}
