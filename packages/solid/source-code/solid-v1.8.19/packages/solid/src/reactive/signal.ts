// Inspired by S.js by Adam Haile, https://github.com/adamhaile/S
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

import { requestCallback, Task } from "./scheduler.js";
import { setHydrateContext, sharedConfig } from "../render/hydration.js";
import type { JSX } from "../jsx.js";
import type { FlowComponent, FlowProps } from "../render/index.js";

export const equalFn = <T>(a: T, b: T) => a === b;
export const $PROXY = Symbol("solid-proxy");
export const $TRACK = Symbol("solid-track");
export const $DEVCOMP = Symbol("solid-dev-component");
// 默认的 signal options
const signalOptions = { equals: equalFn };
let ERROR: symbol | null = null;
// 执行 Effects 队列的方法，在使用 createEffect 之后会变为 runUserEffects 方法
let runEffects = runQueue;
// 标识当前 computation 值已过期，需要更新
const STALE = 1;
// 用于依赖 memo 的 effect，需要等待 memo 更新完成后，才能执行 effect
const PENDING = 2;
const UNOWNED: Owner = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const NO_INIT = {};
export var Owner: Owner | null = null;
export let Transition: TransitionState | null = null;
let Scheduler: ((fn: () => void) => any) | null = null;
let ExternalSourceConfig: {
  factory: ExternalSourceFactory;
  untrack: <V>(fn: () => V) => V;
} | null = null;
/**
 * Listener 指向当前执行的 effect，用于后续依赖收集 Signal
 */
let Listener: Computation<any> | null = null;
/**
 * 目前看的话，是把 Updates 和 Effects 看作两种优先级的队列，像 Updates，是存放 memo 等内置特殊处理的 pure effect
 * 而 Effects 是 createEffect 创建的普通 effect
 * 一次更新过程中，Updates > Effects，即先执行 Updates，再执行 Effects
 */
let Updates: Computation<any>[] | null = null;
let Effects: Computation<any>[] | null = null;
let ExecCount = 0;

/** Object storing callbacks for debugging during development */
export const DevHooks: {
  afterUpdate: (() => void) | null;
  afterCreateOwner: ((owner: Owner) => void) | null;
  afterCreateSignal: ((signal: SignalState<any>) => void) | null;
} = {
  afterUpdate: null,
  afterCreateOwner: null,
  afterCreateSignal: null
};

export type ComputationState = 0 | 1 | 2;

export interface SourceMapValue {
  value: unknown;
  name?: string;
  graph?: Owner;
}

export interface SignalState<T> extends SourceMapValue {
  value: T;
  /**
   * 观察该 Signal 的 Computation
   */
  observers: Computation<any>[] | null;
  /**
   * 这是对应 observers 中 effect 里 sources 对应自身的下标位置
   * (observers[i] as Computation).sources[observerSlots] -> 本身
   * signal 和 effect 两者的 observers、sources、observerSlots、sourceSlots 是一一对应的
   */
  observerSlots: number[] | null;
  /**
   * tValue 是用于 Transition 时，在加载数据时显示回退内容，即旧的 value
   */
  tValue?: T;
  /**
   * 用于判断是否需要重新渲染，通过 options.equals 去配置
   */
  comparator?: (prev: T, next: T) => boolean;
}

export interface Owner {
  owned: Computation<any>[] | null;
  cleanups: (() => void)[] | null;
  owner: Owner | null;
  context: any | null;
  sourceMap?: SourceMapValue[];
  name?: string;
}

export interface Computation<Init, Next extends Init = Init> extends Owner {
  /**
   * 副作用函数
   */
  fn: EffectFunction<Init, Next>;
  /**
   * 标识 effect 当前状态，未设置(0)、STALE(1)、PENDING(2)
   */
  state: ComputationState;
  tState?: ComputationState;
  /**
   * effect 中依赖收集的 Signal
   */
  sources: SignalState<Next>[] | null;
  /**
   * 这是对应 sources 中 Signal 里 observers 对应自身的下标位置
   * (sources[i] as Signal).observers[sourceSlots] -> 本身
   * signal 和 effect 两者的 observers、sources、observerSlots、sourceSlots 是一一对应的
   */
  sourceSlots: number[] | null;
  /**
   * 用于 createMemo 这种特殊的 effect，存在返回值，只读 Signal
   */
  value?: Init;
  updatedAt: number | null;
  /**
   * 区分纯函数（memo）和副作用函数的（effect）
   * 同时它也是区分 Updates 和 Effects 的
   */
  pure: boolean;

  /**
   * 区分是否是用户手动定义的，例如 createEffect 时，user 为 true，而 createMemo 时，user 为 false
   */
  user?: boolean;

  /**
   * 记录当前 Computation 所处的 suspense
   * 用于资源未加载完成，将 effect 存储到 SuspenseContext 当中
   */
  suspense?: SuspenseContextType;
}

export interface TransitionState {
  /**
   * 暂存的 Signal
   */
  sources: Set<SignalState<any>>;
  /**
   * 暂存的 Computation
   */
  effects: Computation<any>[];
  /**
   * 暂存的 resource 请求
   */
  promises: Set<Promise<any>>;
  disposed: Set<Computation<any>>;
  queue: Set<Computation<any>>;
  scheduler?: (fn: () => void) => unknown;
  /**
   * 是否正在执行
   */
  running: boolean;
  /**
   * 是否结束
   */
  done?: Promise<void>;
  resolve?: () => void;
}

type ExternalSourceFactory = <Prev, Next extends Prev = Prev>(
  fn: EffectFunction<Prev, Next>,
  trigger: () => void
) => ExternalSource;

export interface ExternalSource {
  track: EffectFunction<any, any>;
  dispose: () => void;
}

export type RootFunction<T> = (dispose: () => void) => T;

/**
 * Creates a new non-tracked reactive context that doesn't auto-dispose
 *
 * @param fn a function in which the reactive state is scoped
 * @param detachedOwner optional reactive context to bind the root to
 * @returns the output of `fn`.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/create-root
 */
export function createRoot<T>(fn: RootFunction<T>, detachedOwner?: typeof Owner): T {
  const listener = Listener,
    owner = Owner,
    unowned = fn.length === 0,
    current = detachedOwner === undefined ? owner : detachedOwner,
    root: Owner = unowned
      ? "_SOLID_DEV_"
        ? { owned: null, cleanups: null, context: null, owner: null }
        : UNOWNED
      : {
          owned: null,
          cleanups: null,
          context: current ? current.context : null,
          // 这里做了 owner 树
          owner: current
        },
    updateFn = unowned
      ? "_SOLID_DEV_"
        ? () =>
            fn(() => {
              throw new Error("Dispose method must be an explicit argument to createRoot function");
            })
        : fn
        // 返回一个手动 dispose 的函数
      : () => fn(() => untrack(() => cleanNode(root)));

  if ("_SOLID_DEV_") DevHooks.afterCreateOwner && DevHooks.afterCreateOwner(root);

  // 设置了最上层的 owner，为根节点
  Owner = root;
  Listener = null;

  try {
    return runUpdates(updateFn as () => T, true)!;
  } finally {
    Listener = listener;
    Owner = owner;
  }
}

export type Accessor<T> = () => T;

export type Setter<in out T> = {
  <U extends T>(...args: undefined extends T ? [] : [value: (prev: T) => U]): undefined extends T
    ? undefined
    : U;
  <U extends T>(value: (prev: T) => U): U;
  <U extends T>(value: Exclude<U, Function>): U;
  <U extends T>(value: Exclude<U, Function> | ((prev: T) => U)): U;
};

export type Signal<T> = [get: Accessor<T>, set: Setter<T>];

export interface SignalOptions<T> extends MemoOptions<T> {
  internal?: boolean;
}

/**
 * Creates a simple reactive state with a getter and setter
 * ```typescript
 * const [state: Accessor<T>, setState: Setter<T>] = createSignal<T>(
 *  value: T,
 *  options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * )
 * ```
 * @param value initial value of the state; if empty, the state's type will automatically extended with undefined; otherwise you need to extend the type manually if you want setting to undefined not be an error
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns ```typescript
 * [state: Accessor<T>, setState: Setter<T>]
 * ```
 * * the Accessor is merely a function that returns the current value and registers each call to the reactive root
 * * the Setter is a function that allows directly setting or mutating the value:
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * setCount(count => count + 1);
 * ```
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-signal
 */
export function createSignal<T>(): Signal<T | undefined>;
export function createSignal<T>(value: T, options?: SignalOptions<T>): Signal<T>;
export function createSignal<T>(
  value?: T,
  options?: SignalOptions<T | undefined>
): Signal<T | undefined> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;

  /**
   * Signal 对象，包括当前的值、观察者队列、比较器
   * 从这里也可以看出来，signal 只对 value （最外层的对象）做了处理，所以并不能嵌套响应，类似 Vue 的 ref。
   */
  const s: SignalState<T | undefined> = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined
  };
  console.log("🚀 ~ s:", s)

  if ("_SOLID_DEV_") {
    if (options.name) s.name = options.name;
    if (DevHooks.afterCreateSignal) DevHooks.afterCreateSignal(s);
    if (!options.internal) registerGraph(s);
  }

  const setter: Setter<T | undefined> = (value?: unknown) => {
	  // 如果 setter 的是一个函数，则传入 prev 值，先进行计算，获得最新的 value 值
    if (typeof value === "function") {
      if (Transition && Transition.running && Transition.sources.has(s)) value = value(s.tValue);
      else value = value(s.value);
    }
    return writeSignal(s, value);
  };

  return [readSignal.bind(s), setter];
}

export interface BaseOptions {
  name?: string;
}

// Magic type that when used at sites where generic types are inferred from, will prevent those sites from being involved in the inference.
// https://github.com/microsoft/TypeScript/issues/14829
// TypeScript Discord conversation: https://discord.com/channels/508357248330760243/508357248330760249/911266491024949328
export type NoInfer<T extends any> = [T][T extends any ? 0 : never];

export interface EffectOptions extends BaseOptions {}

// Also similar to OnEffectFunction
export type EffectFunction<Prev, Next extends Prev = Prev> = (v: Prev) => Next;

/**
 * Creates a reactive computation that runs immediately before render, mainly used to write to other reactive primitives
 * ```typescript
 * export function createComputed<Next, Init = Next>(
 *   fn: (v: Init | Next) => Next,
 *   value?: Init,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-computed
 */
export function createComputed<Next>(fn: EffectFunction<undefined | NoInfer<Next>, Next>): void;
export function createComputed<Next, Init = Next>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createComputed<Next, Init>(
  fn: EffectFunction<Init | Next, Next>,
  value?: Init,
  options?: EffectOptions
): void {
  // Computed 也是加入到 Updates 队列的
  // pure = true
  const c = createComputation(fn, value!, true, STALE, "_SOLID_DEV_" ? options : undefined);
  if (Scheduler && Transition && Transition.running) Updates!.push(c);
  else updateComputation(c);

  // Computed 和我们之前见过的不一样，它并没有返回一个值
  // 按官方的逻辑，这个函数一般是给其他响应式函数用的，内部使用，不推荐用户使用
}

/**
 * Creates a reactive computation that runs during the render phase as DOM elements are created and updated but not necessarily connected
 * ```typescript
 * export function createRenderEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-render-effect
 */
export function createRenderEffect<Next>(fn: EffectFunction<undefined | NoInfer<Next>, Next>): void;
export function createRenderEffect<Next, Init = Next>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions
): void;
export function createRenderEffect<Next, Init>(
  fn: EffectFunction<Init | Next, Next>,
  value?: Init,
  options?: EffectOptions
): void {
  // 可以看到 pure 也是 false
  // createRenderEffect 和 createEffect 的区别在于第一次执行的时机，更新的执行是一样的
  const c = createComputation(fn, value!, false, STALE, "_SOLID_DEV_" ? options : undefined);
  if (Scheduler && Transition && Transition.running) Updates!.push(c);
  else updateComputation(c);
}

/**
 * Creates a reactive computation that runs after the render phase
 * ```typescript
 * export function createEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-effect
 */
export function createEffect<Next>(fn: EffectFunction<undefined | NoInfer<Next>, Next>): void;
export function createEffect<Next, Init = Next>(
  fn: EffectFunction<Init | Next, Next>,
  value: Init,
  options?: EffectOptions & { render?: boolean }
): void;
export function createEffect<Next, Init>(
  fn: EffectFunction<Init | Next, Next>,
  value?: Init,
  options?: EffectOptions & { render?: boolean }
): void {
  runEffects = runUserEffects;
  const c = createComputation(fn, value!, false, STALE, "_SOLID_DEV_" ? options : undefined),
  s = SuspenseContext && useContext(SuspenseContext);
  console.log("🚀 ~ c:", c)
  // 如果存在 Suspense 进行资源加载时，effect 会存储到 SuspenseContext 中，等资源加载完成后再执行
  if (s) c.suspense = s;
  if (!options || !options.render) c.user = true;
  // 可以看到 computation 一般指 effect，或者含有 effect 作用的 computation，如 memo 等等
  Effects ? Effects.push(c) : updateComputation(c);
}

/**
 * Creates a reactive computation that runs after the render phase with flexible tracking
 * ```typescript
 * export function createReaction(
 *   onInvalidate: () => void,
 *   options?: { name?: string }
 * ): (fn: () => void) => void;
 * ```
 * @param invalidated a function that is called when tracked function is invalidated.
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-reaction
 */
export function createReaction(onInvalidate: () => void, options?: EffectOptions) {
  let fn: (() => void) | undefined;
  const c = createComputation(
      () => {
        // 追踪的函数只会执行一次，然后清除掉
        // 如果需要再次追踪，需要再次调用 tracking
        fn ? fn() : untrack(onInvalidate);
        fn = undefined;
      },
      undefined,
      false,
      0,
      "_SOLID_DEV_" ? options : undefined
    ),
    s = SuspenseContext && useContext(SuspenseContext);
  if (s) c.suspense = s;
  c.user = true;

  // 手动返回一个追踪函数，进行依赖追踪
  return (tracking: () => void) => {
    fn = tracking;
    updateComputation(c);
  };
}

export interface Memo<Prev, Next = Prev> extends SignalState<Next>, Computation<Next> {
  value: Next;
  tOwned?: Computation<Prev | Next, Next>[];
}

export interface MemoOptions<T> extends EffectOptions {
  equals?: false | ((prev: T, next: T) => boolean);
}

/**
 * Creates a readonly derived reactive memoized signal
 * ```typescript
 * export function createMemo<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes and use a custom comparison function in equals
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-memo
 */
// The extra Prev generic parameter separates inference of the effect input
// parameter type from inference of the effect return type, so that the effect
// return type is always used as the memo Accessor's return type.
export function createMemo<Next extends Prev, Prev = Next>(
  fn: EffectFunction<undefined | NoInfer<Prev>, Next>
): Accessor<Next>;
export function createMemo<Next extends Prev, Init = Next, Prev = Next>(
  fn: EffectFunction<Init | Prev, Next>,
  value: Init,
  options?: MemoOptions<Next>
): Accessor<Next>;
export function createMemo<Next extends Prev, Init, Prev>(
  fn: EffectFunction<Init | Prev, Next>,
  value?: Init,
  options?: MemoOptions<Next>
): Accessor<Next> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;

  // memo 存在 computation(effect) 和 signal
  const c: Partial<Memo<Init, Next>> = createComputation(
    fn,
    value!,
    true,
    0,
    "_SOLID_DEV_" ? options : undefined
  ) as Partial<Memo<Init, Next>>;
  console.log("🚀 ~ memo:", c)

  // signal 所有的
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  if (Scheduler && Transition && Transition.running) {
    c.tState = STALE;
    Updates!.push(c as Memo<Init, Next>);
  } else updateComputation(c as Memo<Init, Next>);
  // 返回一个只读的 signal
  return readSignal.bind(c as Memo<Init, Next>);
}

interface Unresolved {
  state: "unresolved";
  loading: false;
  error: undefined;
  latest: undefined;
  (): undefined;
}

interface Pending {
  state: "pending";
  loading: true;
  error: undefined;
  latest: undefined;
  (): undefined;
}

interface Ready<T> {
  state: "ready";
  loading: false;
  error: undefined;
  latest: T;
  (): T;
}

interface Refreshing<T> {
  state: "refreshing";
  loading: true;
  error: undefined;
  latest: T;
  (): T;
}

interface Errored {
  state: "errored";
  loading: false;
  error: any;
  latest: never;
  (): never;
}

export type Resource<T> = Unresolved | Pending | Ready<T> | Refreshing<T> | Errored;

export type InitializedResource<T> = Ready<T> | Refreshing<T> | Errored;

export type ResourceActions<T, R = unknown> = {
  mutate: Setter<T>;
  refetch: (info?: R) => T | Promise<T> | undefined | null;
};

export type ResourceSource<S> = S | false | null | undefined | (() => S | false | null | undefined);

export type ResourceFetcher<S, T, R = unknown> = (
  k: S,
  info: ResourceFetcherInfo<T, R>
) => T | Promise<T>;

export type ResourceFetcherInfo<T, R = unknown> = {
  value: T | undefined;
  refetching: R | boolean;
};

export type ResourceOptions<T, S = unknown> = {
  initialValue?: T;
  name?: string;
  deferStream?: boolean;
  ssrLoadFrom?: "initial" | "server";
  storage?: (init: T | undefined) => [Accessor<T | undefined>, Setter<T | undefined>];
  onHydrated?: (k: S | undefined, info: { value: T | undefined }) => void;
};

export type InitializedResourceOptions<T, S = unknown> = ResourceOptions<T, S> & {
  initialValue: T;
};

export type ResourceReturn<T, R = unknown> = [Resource<T>, ResourceActions<T | undefined, R>];

export type InitializedResourceReturn<T, R = unknown> = [
  InitializedResource<T>,
  ResourceActions<T, R>
];

function isPromise(v: any): v is Promise<any> {
  return v && typeof v === "object" && "then" in v;
}

/**
 * Creates a resource that wraps a repeated promise in a reactive pattern:
 * ```typescript
 * // Without source
 * const [resource, { mutate, refetch }] = createResource(fetcher, options);
 * // With source
 * const [resource, { mutate, refetch }] = createResource(source, fetcher, options);
 * ```
 * @param source - reactive data function which has its non-nullish and non-false values passed to the fetcher, optional
 * @param fetcher - function that receives the source (true if source not provided), the last or initial value, and whether the resource is being refetched, and returns a value or a Promise:
 * ```typescript
 * const fetcher: ResourceFetcher<S, T, R> = (
 *   sourceOutput: S,
 *   info: { value: T | undefined, refetching: R | boolean }
 * ) => T | Promise<T>;
 * ```
 * @param options - an optional object with the initialValue and the name (for debugging purposes); see {@link ResourceOptions}
 *
 * @returns ```typescript
 * [Resource<T>, { mutate: Setter<T>, refetch: () => void }]
 * ```
 *
 * * Setting an `initialValue` in the options will mean that both the prev() accessor and the resource should never return undefined (if that is wanted, you need to extend the type with undefined)
 * * `mutate` allows to manually overwrite the resource without calling the fetcher
 * * `refetch` will re-run the fetcher without changing the source, and if called with a value, that value will be passed to the fetcher via the `refetching` property on the fetcher's second parameter
 *
 * @description https://docs.solidjs.com/reference/basic-reactivity/create-resource
 */
export function createResource<T, R = unknown>(
  fetcher: ResourceFetcher<true, T, R>,
  options: InitializedResourceOptions<NoInfer<T>, true>
): InitializedResourceReturn<T, R>;
export function createResource<T, R = unknown>(
  fetcher: ResourceFetcher<true, T, R>,
  options?: ResourceOptions<NoInfer<T>, true>
): ResourceReturn<T, R>;
export function createResource<T, S, R = unknown>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T, R>,
  options: InitializedResourceOptions<NoInfer<T>, S>
): InitializedResourceReturn<T, R>;
export function createResource<T, S, R = unknown>(
  source: ResourceSource<S>,
  fetcher: ResourceFetcher<S, T, R>,
  options?: ResourceOptions<NoInfer<T>, S>
): ResourceReturn<T, R>;
export function createResource<T, S, R>(
  pSource: ResourceSource<S> | ResourceFetcher<S, T, R>,
  pFetcher?: ResourceFetcher<S, T, R> | ResourceOptions<T, S>,
  pOptions?: ResourceOptions<T, S> | undefined
): ResourceReturn<T, R> {
  // 响应式数据 Signal
  let source: ResourceSource<S>;
  // 请求函数
  let fetcher: ResourceFetcher<S, T, R>;
  let options: ResourceOptions<T, S>;
  if ((arguments.length === 2 && typeof pFetcher === "object") || arguments.length === 1) {
    // 参数为2或者1时，没有 sources 参数，source 为 true
    source = true as ResourceSource<S>;
    fetcher = pSource as ResourceFetcher<S, T, R>;
    options = (pFetcher || {}) as ResourceOptions<T, S>;
  } else {
    // 三个都有的话，就是 source，fetcher，options
    source = pSource as ResourceSource<S>;
    fetcher = pFetcher as ResourceFetcher<S, T, R>;
    options = pOptions || ({} as ResourceOptions<T, S>);
  }

  // 请求函数的 Promise
  let pr: Promise<T> | null = null,
    // Promise 状态
    initP: Promise<T> | T | typeof NO_INIT = NO_INIT,
    id: string | null = null,
    loadedUnderTransition: boolean | null = false,
    scheduled = false,
    resolved = "initialValue" in options,
    // sources 里的 Signal 最终被绑定到了 Memo，如果 source 不存在，则为 true
    dynamic =
    // 这里会为 sources 创建一个 Memo 内嵌依赖，去统一管理所有的 sources
      typeof source === "function" && createMemo(source as () => S | false | null | undefined);

  // 注意 contexts 变量，它用于存储 SuspenseContext，当资源加载完成的时候，通知 SuspenseContext 进行状态更新
  const contexts = new Set<SuspenseContextType>(),
    // options.storage 可以看出来 storage 定义一个自定义存储方式
    [value, setValue] = (options.storage || createSignal)(options.initialValue) as Signal<
      T | undefined
    >,
    [error, setError] = createSignal<unknown>(undefined),
    // TODO: 看着像内部使用
    [track, trigger] = createSignal(undefined, { equals: false }),
    /**
     * 将 resource 的5个状态存储在 contexts 中 {@link Resource}
     */
    [state, setState] = createSignal<"unresolved" | "pending" | "ready" | "refreshing" | "errored">(
      resolved ? "ready" : "unresolved"
    );

  if (sharedConfig.context) {
    id = sharedConfig.getNextContextId();
    let v;
    if (options.ssrLoadFrom === "initial") initP = options.initialValue as T;
    else if (sharedConfig.load && (v = sharedConfig.load(id))) initP = v;
  }
  function loadEnd(p: Promise<T> | null, v: T | undefined, error?: any, key?: S) {
    // 这里的判断就是为了防止多次调用 load（因为请求返回时间不一致，可能会导致更新到老的数据）
    if (pr === p) {
      pr = null;
      key !== undefined && (resolved = true);
      if ((p === initP || v === initP) && options.onHydrated)
        queueMicrotask(() => options.onHydrated!(key, { value: v }));
      // 结束后重置 initP
      initP = NO_INIT;
      if (Transition && p && loadedUnderTransition) {
        Transition.promises.delete(p);
        loadedUnderTransition = false;
        runUpdates(() => {
          Transition!.running = true;
          completeLoad(v, error);
        }, false);
      } else completeLoad(v, error);
    }
    return v;
  }
  function completeLoad(v: T | undefined, err: any) {
    // 更新状态、value、error 等等内容
    runUpdates(() => {
      // 更新 value
      if (err === undefined) setValue(() => v);
      // 更新状态
      setState(err !== undefined ? "errored" : resolved ? "ready" : "unresolved");
      // 更新 error
      setError(err);
      // 注：这里的 value、state、error 都是 Signal，所以会触发通知依赖更新的

      // 资源加载完成后，通知 SuspenseContext 进行状态更新，decrement -> 不需要显示 fallback
      for (const c of contexts.keys()) c.decrement!();
      contexts.clear();
    }, false);
  }

  function read() {
    // 这里会读取当前处于的 SuspenseContext，后续做处理
    const c = SuspenseContext && useContext(SuspenseContext),
      // 注意 value() 和 error()，会进行依赖收集的操作
      // 为后续 value 和 error 变化时触发更新
      v = value(),
      err = error();
    if (err !== undefined && !pr) throw err;
    if (Listener && !Listener.user && c) {
      createComputed(() => {
        track();
        if (pr) {
          if (c.resolved && Transition && loadedUnderTransition) Transition.promises.add(pr);
          // 进行 Suspense 添加，并显示 fallback
          else if (!contexts.has(c)) {
            c.increment!();
            contexts.add(c);
          }
        }
      });
    }
    return v;
  }
  function load(refetching: R | boolean = true) {
    if (refetching !== false && scheduled) return;
    scheduled = false;
    // true
    // 如果 dynamic 有值的话，那么下面会走 createComputed，这里走 dynamic() 进行依赖收集
    // 后续更新的时候直接，重走一遍 load 即可
    const lookup = dynamic ? dynamic() : (source as S);
    loadedUnderTransition = Transition && Transition.running;
    if (lookup == null || lookup === false) {
      loadEnd(pr, untrack(value));
      return;
    }
    if (Transition && pr) Transition.promises.delete(pr);
    // p 表示当前执行的 Promise
    const p =
      initP !== NO_INIT
        ? (initP as T | Promise<T>)
        : untrack(() =>
          // 调用 fetcher
            fetcher(lookup, {
              value: value(),
              refetching
            })
          );
    // 不是 Promise 的话，那说明不是异步，直接更新结束即可
    if (!isPromise(p)) {
      loadEnd(pr, p, undefined, lookup);
      return p;
    }
    // 讲当前执行的 Promise 存储在 pr 中
    // 这里需要注意一点，如果是多次调用 load，那么 pr 存储的是最后一次的 Promise，并且 loadEnd 中
    pr = p;
    // 有 value 说明 Promise 加载完成了
    if ("value" in p) {
      if ((p as any).status === "success") loadEnd(pr, p.value as T, undefined, lookup);
      else loadEnd(pr, undefined, castError(p.value), lookup);
      return p;
    }
    scheduled = true;
    queueMicrotask(() => (scheduled = false));
    // 到这说明 Promise 在走，但是还是完成，所以更新状态
    runUpdates(() => {
      setState(resolved ? "refreshing" : "pending");
      trigger();
    }, false);
    // Promise 完成后，进入 loadEnd
    return p.then(
      v => loadEnd(p, v, undefined, lookup),
      e => loadEnd(p, undefined, castError(e), lookup)
    ) as Promise<T>;
  }
  // 这里的定义，是为了方便使用几个子状态
  Object.defineProperties(read, {
    state: { get: () => state() },
    error: { get: () => error() },
    loading: {
      get() {
        const s = state();
        return s === "pending" || s === "refreshing";
      }
    },
    latest: {
      get() {
        if (!resolved) return read();
        const err = error();
        if (err && !pr) throw err;
        return value();
      }
    }
  });
  // dynamic 的话，就是添加一个监听，当 source 变化的时候重新加载
  // TODO: 看起来像 createComputation 是内部使用的 effect，createEffect 是用户使用的 effect
  if (dynamic) createComputed(() => load(false));
  else load(false);
  // refetch 和 mutate 很简单，从这里也能看到，只是重新调用了之前的方法
  return [read as Resource<T>, { refetch: load, mutate: setValue }];
}

export interface DeferredOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean);
  name?: string;
  timeoutMs?: number;
}

/**
 * Creates a reactive computation that only runs and notifies the reactive context when the browser is idle
 * ```typescript
 * export function createDeferred<T>(
 *   fn: (v: T) => T,
 *   options?: { timeoutMs?: number, name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): () => T);
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param options allows to set the timeout in milliseconds, use a custom comparison function and set a name in dev mode for debugging purposes
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-deferred
 */
export function createDeferred<T>(source: Accessor<T>, options?: DeferredOptions<T>) {
  // 注意：它返回一个只读的 Signal

  let t: Task,
    timeout = options ? options.timeoutMs : undefined;
  const node = createComputation(
    () => {
      if (!t || !t.fn)
        // 利用 requestCallback 来实现，这个函数会在下一次 idle 的时候执行，这样就能实现在浏览器空闲的时候，更新值
        t = requestCallback(
          // 实现推迟更新 deferred 值
          () => setDeferred(() => node.value as T),
          timeout !== undefined ? { timeout } : undefined
        );
      return source();
    },
    undefined,
    true
  ) as Memo<any>;
  const [deferred, setDeferred] = createSignal(
    Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value,
    options
  );
  updateComputation(node);
  setDeferred(() =>
    Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value
  );
  return deferred;
}

export type EqualityCheckerFunction<T, U> = (a: U, b: T) => boolean;

/**
 * Creates a conditional signal that only notifies subscribers when entering or exiting their key matching the value
 * ```typescript
 * export function createSelector<T, U>(
 *   source: () => T
 *   fn: (a: U, b: T) => boolean,
 *   options?: { name?: string }
 * ): (k: U) => boolean;
 * ```
 * @param source
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param options allows to set a name in dev mode for debugging purposes, optional
 *
 * ```typescript
 * const isSelected = createSelector(selectedId);
 * <For each={list()}>
 *   {(item) => <li classList={{ active: isSelected(item.id) }}>{item.name}</li>}
 * </For>
 * ```
 *
 * This makes the operation O(2) instead of O(n).
 *
 * @description https://docs.solidjs.com/reference/secondary-primitives/create-selector
 */
export function createSelector<T, U = T>(
  source: Accessor<T>,
  fn: EqualityCheckerFunction<T, U> = equalFn as TODO,
  options?: BaseOptions
): (key: U) => boolean {
  // sub 是一个 key -> Set<Computation<any>> 的 Map，用于存储每一个 key 对应的依赖 Computation
  // 用于后续实现 O(2) 的更新思路
  // 只需要更新之前选中的取消和现在未选中的进行选中
  // 有点像 Vue ref 的对象依赖收集
  const subs = new Map<U, Set<Computation<any>>>();
  const node = createComputation(
    (p: T | undefined) => {
      // 这边注意 source()，这里是个 Computation，所以 source 和这里的 Computation 建立了依赖关系
      const v = source();
      // 遍历 subs，进行 equal 判断，找到需要更新的地方（实现O(2)）
      for (const [key, val] of subs.entries())
        if (fn(key, v) !== fn(key, p!)) {
          for (const c of val.values()) {
            c.state = STALE;
            if (c.pure) Updates!.push(c);
            else Effects!.push(c);
          }
        }
      return v;
    },
    undefined,
    true,
    STALE,
    "_SOLID_DEV_" ? options : undefined
  ) as Memo<any>;
  updateComputation(node);
  return (key: U) => {
    // 拿到当前包裹的 Computation
    const listener = Listener;
    if (listener) {
      // 根据 key 找到对应的依赖集，添加依赖
      let l: Set<Computation<any>> | undefined;
      if ((l = subs.get(key))) l.add(listener);
      else subs.set(key, (l = new Set([listener])));
      onCleanup(() => {
        console.log('cleanup')
        l!.delete(listener!);
        !l!.size && subs.delete(key);
      });
    }
    // 返回一个新旧值的 equal 判断
    return fn(
      key,
      Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value!
    );
  };
}

/**
 * Holds changes inside the block before the reactive context is updated
 * @param fn wraps the reactive updates that should be batched
 * @returns the return value from `fn`
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/batch
 */
export function batch<T>(fn: Accessor<T>): T {
  // batch 本质就是 runUpdates，实现同一批次的 统一更新，原理原来这么简单
  return runUpdates(fn, false) as T;
}

/**
 * Ignores tracking context inside its scope
 * @param fn the scope that is out of the tracking context
 * @returns the return value of `fn`
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/untrack
 */
export function untrack<T>(fn: Accessor<T>): T {
  // untrack 原理只是暂时去除了 Listener，防止依赖收集，太妙了

  if (!ExternalSourceConfig && Listener === null) return fn();

  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig) return ExternalSourceConfig.untrack(fn);
    return fn();
  } finally {
    Listener = listener;
  }
}

/** @deprecated */
export type ReturnTypes<T> = T extends readonly Accessor<unknown>[]
  ? { [K in keyof T]: T[K] extends Accessor<infer I> ? I : never }
  : T extends Accessor<infer I>
  ? I
  : never;

// transforms a tuple to a tuple of accessors in a way that allows generics to be inferred
export type AccessorArray<T> = [...Extract<{ [K in keyof T]: Accessor<T[K]> }, readonly unknown[]>];

// Also similar to EffectFunction
export type OnEffectFunction<S, Prev, Next extends Prev = Prev> = (
  input: S,
  prevInput: S | undefined,
  prev: Prev
) => Next;

export interface OnOptions {
  defer?: boolean;
}

/**
 * Makes dependencies of a computation explicit
 * ```typescript
 * export function on<S, U>(
 *   deps: Accessor<S> | AccessorArray<S>,
 *   fn: (input: S, prevInput: S | undefined, prevValue: U | undefined) => U,
 *   options?: { defer?: boolean } = {}
 * ): (prevValue: U | undefined) => U;
 * ```
 * @param deps list of reactive dependencies or a single reactive dependency
 * @param fn computation on input; the current previous content(s) of input and the previous value are given as arguments and it returns a new value
 * @param options optional, allows deferred computation until at the end of the next change
 * @returns an effect function that is passed into createEffect. For example:
 *
 * ```typescript
 * createEffect(on(a, (v) => console.log(v, b())));
 *
 * // is equivalent to:
 * createEffect(() => {
 *   const v = a();
 *   untrack(() => console.log(v, b()));
 * });
 * ```
 *
 * @description https://docs.solidjs.com/reference/jsx-attributes/on_
 */
export function on<S, Next extends Prev, Prev = Next>(
  deps: AccessorArray<S> | Accessor<S>,
  fn: OnEffectFunction<S, undefined | NoInfer<Prev>, Next>,
  options?: OnOptions & { defer?: false }
): EffectFunction<undefined | NoInfer<Next>, NoInfer<Next>>;
export function on<S, Next extends Prev, Prev = Next>(
  deps: AccessorArray<S> | Accessor<S>,
  fn: OnEffectFunction<S, undefined | NoInfer<Prev>, Next>,
  options: OnOptions | { defer: true }
): EffectFunction<undefined | NoInfer<Next>>;
export function on<S, Next extends Prev, Prev = Next>(
  deps: AccessorArray<S> | Accessor<S>,
  fn: OnEffectFunction<S, undefined | NoInfer<Prev>, Next>,
  options?: OnOptions
): EffectFunction<undefined | NoInfer<Next>> {
  const isArray = Array.isArray(deps);
  let prevInput: S;
  let defer = options && options.defer;

  // 生成一个供 createEffect 使用的 副作用函数
  return prevValue => {
    let input: S;
    // 对于指定的依赖调用，进行依赖收集
    if (isArray) {
      input = Array(deps.length) as unknown as S;
      for (let i = 0; i < deps.length; i++) (input as unknown as TODO[])[i] = deps[i]();
    } else input = deps();
    if (defer) {
      defer = false;
      return prevValue;
    }
    // 同时，取消 fn 函数内的依赖收集
    const result = untrack(() => fn(input, prevInput, prevValue));
    prevInput = input;
    return result;
  };
}

/**
 * Runs an effect only after initial render on mount
 * @param fn an effect that should run only once on mount
 *
 * @description https://docs.solidjs.com/reference/lifecycle/on-mount
 */
export function onMount(fn: () => void) {
  // 酷，直接用 createEffect + untrack 实现只执行一次的效果
  createEffect(() => untrack(fn));
}

/**
 * Runs an effect once before the reactive scope is disposed
 * @param fn an effect that should run only once on cleanup
 *
 * @returns the same {@link fn} function that was passed in
 *
 * @description https://docs.solidjs.com/reference/lifecycle/on-cleanup
 */
export function onCleanup<T extends () => any>(fn: T): T {
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}

/**
 * Runs an effect whenever an error is thrown within the context of the child scopes
 * @param fn boundary for the error
 * @param handler an error handler that receives the error
 *
 * * If the error is thrown again inside the error handler, it will trigger the next available parent handler
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/catch-error
 */
export function catchError<T>(fn: () => T, handler: (err: Error) => void) {
  ERROR || (ERROR = Symbol("error"));
  Owner = createComputation(undefined!, undefined, true);
  Owner.context = { ...Owner.context, [ERROR]: [handler] };
  if (Transition && Transition.running) Transition.sources.add(Owner as Memo<any>);
  try {
    return fn();
  } catch (err) {
    handleError(err);
  } finally {
    Owner = Owner.owner;
  }
}

export function getListener() {
  return Listener;
}

export function getOwner() {
  return Owner;
}

export function runWithOwner<T>(o: typeof Owner, fn: () => T): T | undefined {
  const prev = Owner;
  const prevListener = Listener;
  Owner = o;
  Listener = null;
  try {
    return runUpdates(fn, true)!;
  } catch (err) {
    handleError(err);
  } finally {
    Owner = prev;
    Listener = prevListener;
  }
}

// Transitions
export function enableScheduling(scheduler = requestCallback) {
  Scheduler = scheduler;
}

/**
 * ```typescript
 * export function startTransition(fn: () => void) => Promise<void>
 * ```
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/start-transition
 */
// 开启 Transition 状态
export function startTransition(fn: () => unknown): Promise<void> {
  if (Transition && Transition.running) {
    fn();
    return Transition.done!;
  }
  const l = Listener;
  const o = Owner;

  // 利用 Promise.resolve() 实现延迟执行
  return Promise.resolve().then(() => {
    Listener = l;
    Owner = o;
    let t: TransitionState | undefined;
    if (Scheduler || SuspenseContext) {
      t =
        Transition ||
        // Transition 在这边生成
        // 看得出来，Transition 里面会暂存所有 Signal、Computation 等内容，等待下一次调度执行
        (Transition = {
          sources: new Set(),
          effects: [],
          promises: new Set(),
          disposed: new Set(),
          queue: new Set(),
          running: true
        });
      t.done || (t.done = new Promise(res => (t!.resolve = res)));
      t.running = true;
    }
    // 这里再执行 fn
    runUpdates(fn, false);
    Listener = Owner = null;
    return t ? t.done : undefined;
  });
}

// keep immediately evaluated module code, below its dependencies like Listener & createSignal
// Transition isPending 状态
const [transPending, setTransPending] = /*@__PURE__*/ createSignal(false);

export type Transition = [Accessor<boolean>, (fn: () => void) => Promise<void>];

/**
 * ```typescript
 * export function useTransition(): [
 *   () => boolean,
 *   (fn: () => void, cb?: () => void) => void
 * ];
 * @returns a tuple; first value is an accessor if the transition is pending and a callback to start the transition
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/use-transition
 */
export function useTransition(): Transition {
  // 这是把两个内部的两个变量给抽离出来了，这样每个 useTransition 拿到的状态都是统一的，不错
  return [transPending, startTransition];
}

export function resumeEffects(e: Computation<any>[]) {
  Effects!.push.apply(Effects, e);
  e.length = 0;
}

export interface DevComponent<T> extends Memo<unknown> {
  props: T;
  name: string;
  component: (props: T) => unknown;
}

// Dev
/**
 * devComponent 相比 Comp 对多包裹了一层，应该是做一些开发的记录
 */
export function devComponent<P, V>(Comp: (props: P) => V, props: P): V {
  const c = createComputation(
    () =>
      untrack(() => {
        Object.assign(Comp, { [$DEVCOMP]: true });
        return Comp(props);
      }),
    undefined,
    true,
    0
  ) as DevComponent<P>;
  c.props = props;
  c.observers = null;
  c.observerSlots = null;
  c.name = Comp.name;
  c.component = Comp;
  updateComputation(c);

  // 这里的返回还是一个 JSX.Element
  return (c.tValue !== undefined ? c.tValue : c.value) as V;
}

export function registerGraph(value: SourceMapValue): void {
  if (!Owner) return;
  if (Owner.sourceMap) Owner.sourceMap.push(value);
  else Owner.sourceMap = [value];
  value.graph = Owner;
}

export type ContextProviderComponent<T> = FlowComponent<{ value: T }>;

// Context API
export interface Context<T> {
  id: symbol;
  Provider: ContextProviderComponent<T>;
  defaultValue: T;
}

/**
 * Creates a Context to handle a state scoped for the children of a component
 * ```typescript
 * interface Context<T> {
 *   id: symbol;
 *   Provider: FlowComponent<{ value: T }>;
 *   defaultValue: T;
 * }
 * export function createContext<T>(
 *   defaultValue?: T,
 *   options?: { name?: string }
 * ): Context<T | undefined>;
 * ```
 * @param defaultValue optional default to inject into context
 * @param options allows to set a name in dev mode for debugging purposes
 * @returns The context that contains the Provider Component and that can be used with `useContext`
 *
 * @description https://docs.solidjs.com/reference/component-apis/create-context
 */
export function createContext<T>(
  defaultValue?: undefined,
  options?: EffectOptions
): Context<T | undefined>;
export function createContext<T>(defaultValue: T, options?: EffectOptions): Context<T>;
export function createContext<T>(
  defaultValue?: T,
  options?: EffectOptions
): Context<T | undefined> {
  const id = Symbol("context");
  return { id, Provider: createProvider(id, options), defaultValue };
}

/**
 * Uses a context to receive a scoped state from a parent's Context.Provider
 *
 * @param context Context object made by `createContext`
 * @returns the current or `defaultValue`, if present
 *
 * @description https://docs.solidjs.com/reference/component-apis/use-context
 */
export function useContext<T>(context: Context<T>): T {
  let value: undefined | T;
  // 这里就利用 Provider 在 Owner  上添加的 context 去找到对应的键值对，进行操作
  return Owner && Owner.context && (value = Owner.context[context.id]) !== undefined
    ? value
    : context.defaultValue;
}

export type ResolvedJSXElement = Exclude<JSX.Element, JSX.ArrayElement>;
export type ResolvedChildren = ResolvedJSXElement | ResolvedJSXElement[];
export type ChildrenReturn = Accessor<ResolvedChildren> & { toArray: () => ResolvedJSXElement[] };

/**
 * Resolves child elements to help interact with children
 *
 * @param fn an accessor for the children
 * @returns a accessor of the same children, but resolved
 *
 * @description https://docs.solidjs.com/reference/component-apis/children
 */
export function children(fn: Accessor<JSX.Element>): ChildrenReturn {
  const children = createMemo(fn);
  const memo = "_SOLID_DEV_"
    ? createMemo(() => resolveChildren(children()), undefined, { name: "children" })
    : createMemo(() => resolveChildren(children()));
  (memo as ChildrenReturn).toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo as ChildrenReturn;
}

// Resource API
export type SuspenseContextType = {
  increment?: () => void;
  decrement?: () => void;
  inFallback?: () => boolean;
  effects?: Computation<any>[];
  resolved?: boolean;
};

type SuspenseContext = Context<SuspenseContextType | undefined> & {
  active?(): boolean;
  increment?(): void;
  decrement?(): void;
};

let SuspenseContext: SuspenseContext;

export function getSuspenseContext() {
  return SuspenseContext || (SuspenseContext = createContext<SuspenseContextType | undefined>());
}

// Interop
export function enableExternalSource(
  factory: ExternalSourceFactory,
  untrack: <V>(fn: () => V) => V = fn => fn()
) {
  if (ExternalSourceConfig) {
    const { factory: oldFactory, untrack: oldUntrack } = ExternalSourceConfig;
    ExternalSourceConfig = {
      factory: (fn, trigger) => {
        const oldSource = oldFactory(fn, trigger);
        const source = factory(x => oldSource.track(x), trigger);
        return {
          track: x => source.track(x),
          dispose() {
            source.dispose();
            oldSource.dispose();
          }
        };
      },
      untrack: fn => oldUntrack(() => untrack(fn))
    };
  } else {
    ExternalSourceConfig = { factory, untrack };
  }
}

// Internal
export function readSignal(this: SignalState<any> | Memo<any>) {
  const runningTransition = Transition && Transition.running;

  /**
   * 这里是对 createMemo 的处理，因为 memo 本身也是 effect 的一种衍生，所以它也会监听内部的 signal 变化，即 sources
   */
  if (
    (this as Memo<any>).sources &&
    (runningTransition ? (this as Memo<any>).tState : (this as Memo<any>).state)
  ) {
    // 这边的 STALE 应该是标识数据更新了，当前 memo 需要重新执行了
    // Transition 和 非Transition 做的事情都是一样的，只是存的地方不一样，但是该计算的时候还是会计算，只是暂存的 tValue/tState 上，等过渡完成之后，再进行转移
    if ((runningTransition ? (this as Memo<any>).tState : (this as Memo<any>).state) === STALE)
      updateComputation(this as Memo<any>);
    else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this as Memo<any>), false);
      Updates = updates;
    }
  }
  // 这里的 Listener 就是当前执行的 effect，赋值是在 runComputation 中传递的，用于后续进行依赖收集的
  if (Listener) {
    // 这边的逻辑就是 signal 和 effect 的相互收集
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots!.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots!.push(Listener.sources.length - 1);
    }
  }
  if (runningTransition && Transition!.sources.has(this)) return this.tValue;
  return this.value;
}

export function writeSignal(node: SignalState<any> | Memo<any>, value: any, isComp?: boolean) {
  let current =
    Transition && Transition.running && Transition.sources.has(node) ? node.tValue : node.value;
  if (!node.comparator || !node.comparator(current, value)) {
    // 一样的，如果走 Transition，这里的 Signal 以及后续影响的 Computation 都是走 tXxx 进行暂存
    if (Transition) {
      const TransitionRunning = Transition.running;
      if (TransitionRunning || (!isComp && Transition.sources.has(node))) {
        Transition.sources.add(node);
        node.tValue = value;
      }
      if (!TransitionRunning) node.value = value;
    }
    // 赋值
    else node.value = value;
    // 通知观察者更新
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0; i < node.observers!.length; i += 1) {
          const o = node.observers![i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition!.disposed.has(o)) continue;
          // 根据不同情况，将 effect 加入不同的更新队列中
          // 如果当前 effect 的状态还未处于更新，只加入更新队列
          if (TransitionRunning ? !o.tState : !o.state) {
            // TODO: pure、Updates、Effects
            if (o.pure) Updates!.push(o);
            else Effects!.push(o);
            // memo 比较特殊，因为它是一个 effect 和 signal 的结合体，所以还需要处理它的 observers
            if ((o as Memo<any>).observers) markDownstream(o as Memo<any>);
          }
          // 这边就可以看到 STALE 是用于标识当前数据已经过期了，需要更新
          if (!TransitionRunning) o.state = STALE;
          else o.tState = STALE;
        }
        if (Updates!.length > 10e5) {
          Updates = [];
          if ("_SOLID_DEV_") throw new Error("Potential Infinite Loop Detected.");
          throw new Error();
        }
      }, false);
    }
  }
  return value;
}

/**
 * 更新 effect
 */
function updateComputation(node: Computation<any>) {
  if (!node.fn) return;
  cleanNode(node);
  // 计数 updateAt
  const time = ExecCount;
  runComputation(
    node,
    Transition && Transition.running && Transition.sources.has(node as Memo<any>)
      ? (node as Memo<any>).tValue
      : node.value,
    time
  );

  if (Transition && !Transition.running && Transition.sources.has(node as Memo<any>)) {
    queueMicrotask(() => {
      runUpdates(() => {
        Transition && (Transition.running = true);
        Listener = Owner = node;
        runComputation(node, (node as Memo<any>).tValue, time);
        Listener = Owner = null;
      }, false);
    });
  }
}

/**
 * 执行 effect
 */
function runComputation(node: Computation<any>, value: any, time: number) {
  let nextValue;
  /**
   * 这里实际上可以理解为 listener， owner 的两个调用栈（嵌套）
   * 先保存 prev 的 owner 和 listener，在赋值到当前的 owner 和 listener 进行处理
   * 并在最后将当前的 owner 和 listener 赋值到 prev 的 owner 和 listener
   * 如果内部还有嵌套的 runComputation，那么就会递归继续存储 owner 和 listener
   */
  const owner = Owner,
    listener = Listener;
  // 从这里可以看出，Listener 应该指向当前执行的 effect，或者说含有 effect 效果的节点（memo）
  Listener = Owner = node;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    if (node.pure) {
      if (Transition && Transition.running) {
        node.tState = STALE;
        (node as Memo<any>).tOwned && (node as Memo<any>).tOwned!.forEach(cleanNode);
        (node as Memo<any>).tOwned = undefined;
      } else {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    // won't be picked up until next update
    node.updatedAt = time + 1;
    return handleError(err);
  } finally {
    // 恢复为之前的
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    // 对于 memo effect 的特殊处理，手动更新 Signal，通知依赖它的 effect
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node as Memo<any>, nextValue, true);
    } else if (Transition && Transition.running && node.pure) {
      Transition.sources.add(node as Memo<any>);
      (node as Memo<any>).tValue = nextValue;
    } else node.value = nextValue;
    // 更新 updateAt
    node.updatedAt = time;
  }
}

function createComputation<Next, Init = unknown>(
  fn: EffectFunction<Init | Next, Next>,
  init: Init,
  pure: boolean,
  state: ComputationState = STALE,
  options?: EffectOptions
): Computation<Init | Next, Next> {
  const c: Computation<Init | Next, Next> = {
    fn,
    state: state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };

  if (Transition && Transition.running) {
    c.state = 0;
    c.tState = state;
  }

  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn(
        "computations created outside a `createRoot` or `render` will never be disposed"
      );
  else if (Owner !== UNOWNED) {
    if (Transition && Transition.running && (Owner as Memo<Init, Next>).pure) {
      if (!(Owner as Memo<Init, Next>).tOwned) (Owner as Memo<Init, Next>).tOwned = [c];
      else (Owner as Memo<Init, Next>).tOwned!.push(c);
    } else {
      if (!Owner.owned) Owner.owned = [c];
      else Owner.owned.push(c);
    }
  }

  if ("_SOLID_DEV_" && options && options.name) c.name = options.name;

  if (ExternalSourceConfig && c.fn) {
    // 这一行，真正的把 Signal 给诠释出来了
    const [track, trigger] = createSignal<void>(undefined, { equals: false });
    const ordinary = ExternalSourceConfig.factory(c.fn, trigger);
    onCleanup(() => ordinary.dispose());
    const triggerInTransition: () => void = () =>
      startTransition(trigger).then(() => inTransition.dispose());
    const inTransition = ExternalSourceConfig.factory(c.fn, triggerInTransition);
    c.fn = x => {
      track();
      return Transition && Transition.running ? inTransition.track(x) : ordinary.track(x);
    };
  }

  if ("_SOLID_DEV_") DevHooks.afterCreateOwner && DevHooks.afterCreateOwner(c);

  return c;
}

/**
 * 向上查找 effect 的所有 owner，并通知它们更新
 */
function runTop(node: Computation<any>) {
  const runningTransition = Transition && Transition.running;
  if ((runningTransition ? node.tState : node.state) === 0) return;
  if ((runningTransition ? node.tState : node.state) === PENDING) return lookUpstream(node);
  // 这里对 Suspense 的 effect 做处理，如果资源还在加载，则先加入到 effects 中，等待后续处理
  if (node.suspense && untrack(node.suspense.inFallback!))
    return node!.suspense.effects!.push(node!);
  // 收集相关联的 effect
  const ancestors = [node];
  while (
    (node = node.owner as Computation<any>) &&
    (!node.updatedAt || node.updatedAt < ExecCount)
  ) {
    if (runningTransition && Transition!.disposed.has(node)) return;
    if (runningTransition ? node.tState : node.state) ancestors.push(node);
  }
  // 准备更新 node 及其相关的每一个 effect
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if (runningTransition) {
      let top = node,
        prev = ancestors[i + 1];
      while ((top = top.owner as Computation<any>) && top !== prev) {
        if (Transition!.disposed.has(top)) return;
      }
    }
    // 标明 signal 已经更新，对应的 effect 需要重新计算
    if ((runningTransition ? node.tState : node.state) === STALE) {
      updateComputation(node);
    } else if ((runningTransition ? node.tState : node.state) === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}

function runUpdates<T>(fn: () => T, init: boolean) {
  // 如果存在 Updates，则继续执行 fn，再次进行 Updates、Effects 的收集，直到所有的 Updates 先被处理完成
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  // 如果存在 Effects，则继续等待，直到所以需要的 effect 都被处理完成
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    // 执行 fn，通知 observers，更新 Updates、Effects
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    handleError(err);
  }
}

function completeUpdates(wait: boolean) {
  // 优先更新 Updates
  if (Updates) {
    // 存在 Scheduler 的话，那么会将更新加入到队列中，不会立即执行
    if (Scheduler && Transition && Transition.running) scheduleQueue(Updates);
    else runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  let res;
  // 这里是对 Transition 完成的操作
  if (Transition) {
    if (!Transition.promises.size && !Transition.queue.size) {
      // finish transition
      const sources = Transition.sources;
      const disposed = Transition.disposed;
      Effects!.push.apply(Effects, Transition!.effects);
      res = Transition.resolve;
      // Transition 之后，将 tState 的值转回 state 中
      for (const e of Effects!) {
        "tState" in e && (e.state = e.tState!);
        delete e.tState;
      }
      Transition = null;
      runUpdates(() => {
        for (const d of disposed) cleanNode(d);
        // 再对 Signal 的 value 进行转移
        for (const v of sources) {
          v.value = v.tValue;
          if ((v as Memo<any>).owned) {
            for (let i = 0, len = (v as Memo<any>).owned!.length; i < len; i++)
              cleanNode((v as Memo<any>).owned![i]);
          }
          if ((v as Memo<any>).tOwned) (v as Memo<any>).owned = (v as Memo<any>).tOwned!;
          delete v.tValue;
          delete (v as Memo<any>).tOwned;
          (v as Memo<any>).tState = 0;
        }
        setTransPending(false);
      }, false);
    } else if (Transition.running) {
      // 如果走着，那么 Effects 都会暂存到 Transition 中，下面的 runEffects 不会走了
      Transition.running = false;
      Transition.effects.push.apply(Transition.effects, Effects!);
      Effects = null;
      setTransPending(true);
      return;
    }
  }
  const e = Effects!;
  Effects = null;
  // 更新完成后，更新所有 effect
  // false: 能走到这，那么已经不需要 wait 了，该执行并更新了
  if (e!.length) runUpdates(() => runEffects(e), false);
  else if ("_SOLID_DEV_") DevHooks.afterUpdate && DevHooks.afterUpdate();
  if (res) res();
}

/**
 * 将需要更新的加入到队列中，等待后续更新
 */
function runQueue(queue: Computation<any>[]) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}

function scheduleQueue(queue: Computation<any>[]) {
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const tasks = Transition!.queue;
    if (!tasks.has(item)) {
      tasks.add(item);
      Scheduler!(() => {
        tasks.delete(item);
        runUpdates(() => {
          Transition!.running = true;
          runTop(item);
        }, false);
        Transition && (Transition.running = false);
      });
    }
  }
}

/**
 * 与 runQueue 相同，但区分 effect 的 user 属性，看样子用户创建的 effect，更新会推迟
 */
function runUserEffects(queue: Computation<any>[]) {
  let i,
    userLength = 0;
  // 区分出用户创建的 effect，还是内部创建的
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);
    else queue[userLength++] = e;
  }
  if (sharedConfig.context) {
    if (sharedConfig.count) {
      sharedConfig.effects || (sharedConfig.effects = []);
      sharedConfig.effects.push(...queue.slice(0, userLength));
      return;
    } else if (sharedConfig.effects) {
      queue = [...sharedConfig.effects, ...queue];
      userLength += sharedConfig.effects.length;
      delete sharedConfig.effects;
    }
    setHydrateContext();
  }
  for (i = 0; i < userLength; i++) runTop(queue[i]);
}

/**
 * 向上查找 memo 所依赖的 sources，如果存在未更新的 memo，则更新
 * 同时递归向上找到所有依赖的 memo，直至所有依赖更新完成后，当前 memo 可更新成最新值
 */
function lookUpstream(node: Computation<any>, ignore?: Computation<any>) {
  const runningTransition = Transition && Transition.running;
  // 注意，重置当前 node 的状态，不然后续当前 node 无法更新
  if (runningTransition) node.tState = 0;
  else node.state = 0;
  for (let i = 0; i < node.sources!.length; i += 1) {
    // 这里 source 本应该是个 Signal，再通过下面 source.sources 的判断，我们就可以理解了
    // 就是 Memo 依赖的向上递归更新
    const source = node.sources![i] as Memo<any>;
    if (source.sources) {
      const state = runningTransition ? source.tState : source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount))
          runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}

/**
 * 向下查找 监听当前 memo 的 observers，通知所有 observer 更新
 * 同时如果监听的是 memo，也需要向下查找所有依赖的 memo，直至所有 observer 都通知完成
 */
function markDownstream(node: Memo<any>) {
  const runningTransition = Transition && Transition.running;
  for (let i = 0; i < node.observers!.length; i += 1) {
    const o = node.observers![i];
    if (runningTransition ? !o.tState : !o.state) {
      // 这里是使用 PENDING 状态的地方
      // 原因就是当前 node 还未更新，监听它的 observer 需要暂时等待
      if (runningTransition) o.tState = PENDING;
      else o.state = PENDING;
      // 这里和之前的判断逻辑类似
      if (o.pure) Updates!.push(o);
      else Effects!.push(o);
      (o as Memo<any>).observers && markDownstream(o as Memo<any>);
    }
  }
}

/**
 * 清空 node(Computation) 与 signal 之前存在的依赖关系，同时重置 state
 */
function cleanNode(node: Owner) {
  let i;
  if ((node as Computation<any>).sources) {
    while ((node as Computation<any>).sources!.length) {
      const source = (node as Computation<any>).sources!.pop()!,
        index = (node as Computation<any>).sourceSlots!.pop()!,
        obs = source.observers;
      if (obs && obs.length) {
        // 利用 source.observers 的最后一位去覆盖当前需要清除的 effect
        const n = obs.pop()!,
          s = source.observerSlots!.pop()!;
        if (index < obs.length) {
          // 更新最后一位 observer 的位置，为需要覆盖的位置
          n.sourceSlots![s] = index;
          // 更新最后一位 observer 在 source.observers 中的位置
          obs[index] = n;
          // 更新 source.observerSlots 中最后一位 observer 的位置
          source.observerSlots![index] = s;
        }
      }
    }
  }

  if (Transition && Transition.running && (node as Memo<any>).pure) {
    if ((node as Memo<any>).tOwned) {
      for (i = (node as Memo<any>).tOwned!.length - 1; i >= 0; i--)
        cleanNode((node as Memo<any>).tOwned![i]);
      delete (node as Memo<any>).tOwned;
    }
    reset(node as Computation<any>, true);
  } else if (node.owned) {
    for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
    node.owned = null;
  }

  // 清理函数会在每次 cleanNode 之后执行
  if (node.cleanups) {
    for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = null;
  }
  if (Transition && Transition.running) (node as Computation<any>).tState = 0;
  else (node as Computation<any>).state = 0;
  "_SOLID_DEV_" && delete node.sourceMap;
}

function reset(node: Computation<any>, top?: boolean) {
  if (!top) {
    node.tState = 0;
    Transition!.disposed.add(node);
  }
  if (node.owned) {
    for (let i = 0; i < node.owned.length; i++) reset(node.owned[i]);
  }
}

function castError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", { cause: err });
}

function runErrors(err: unknown, fns: ((err: any) => void)[], owner: Owner | null) {
  try {
    for (const f of fns) f(err);
  } catch (e) {
    handleError(e, (owner && owner.owner) || null);
  }
}

function handleError(err: unknown, owner = Owner) {
  // 这里会取出 onError 监听的函数列表
  const fns = ERROR && owner && owner.context && owner.context[ERROR];
  const error = castError(err);
  if (!fns) throw error;

  if (Effects)
    Effects!.push({
      fn() {
        runErrors(error, fns, owner);
      },
      state: STALE
    } as unknown as Computation<any>);
  else runErrors(error, fns, owner);
}

function resolveChildren(children: JSX.Element | Accessor<any>): ResolvedChildren {
  if (typeof children === "function" && !children.length) return resolveChildren(children());
  if (Array.isArray(children)) {
    const results: any[] = [];
    for (let i = 0; i < children.length; i++) {
      const result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children as ResolvedChildren;
}

function createProvider(id: symbol, options?: EffectOptions) {
  // Provider 返回一个函数式组件
  return function provider(props: FlowProps<{ value: unknown }>) {
    let res;
    createRenderEffect(
      () =>
        (res = untrack(() => {
          // 会在 Owner 的 context 中添加一个专属的 context 内容
          Owner!.context = { ...Owner!.context, [id]: props.value };
          // 然后再返回子节点的内容
          return children(() => props.children);
        })),
      undefined,
      options
    );
    return res;
  };
}

type TODO = any;

/**
 * @deprecated since version 1.7.0 and will be removed in next major - use catchError instead
 * onError - run an effect whenever an error is thrown within the context of the child scopes
 * @param fn an error handler that receives the error
 *
 * * If the error is thrown again inside the error handler, it will trigger the next available parent handler
 *
 * @description https://www.solidjs.com/docs/latest/api#onerror | https://docs.solidjs.com/reference/reactive-utilities/catch-error
 */
export function onError(fn: (err: Error) => void): void {
  ERROR || (ERROR = Symbol("error"));
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn("error handlers created outside a `createRoot` or `render` will never be run");
  else if (Owner.context === null || !Owner.context[ERROR]) {
    // terrible de-opt
    Owner.context = { ...Owner.context, [ERROR]: [fn] };
    mutateContext(Owner, ERROR, [fn]);
  } else Owner.context[ERROR].push(fn);
}

function mutateContext(o: Owner, key: symbol, value: any) {
  if (o.owned) {
    for (let i = 0; i < o.owned.length; i++) {
      if (o.owned[i].context === o.context) mutateContext(o.owned[i], key, value);
      if (!o.owned[i].context) {
        o.owned[i].context = o.context;
        mutateContext(o.owned[i], key, value);
      } else if (!o.owned[i].context[key]) {
        o.owned[i].context[key] = value;
        mutateContext(o.owned[i], key, value);
      }
    }
  }
}
