import {
  untrack,
  createSignal,
  createResource,
  createMemo,
  devComponent,
  $PROXY,
  $DEVCOMP,
  EffectFunction
} from "../reactive/signal.js";
import { sharedConfig, nextHydrateContext, setHydrateContext } from "./hydration.js";
import type { JSX } from "../jsx.js";

let hydrationEnabled = false;
export function enableHydration() {
  hydrationEnabled = true;
}

/**
 * A general `Component` has no implicit `children` prop.  If desired, you can
 * specify one as in `Component<{name: String, children: JSX.Element}>`.
 */
export type Component<P = {}> = (props: P) => JSX.Element;

/**
 * Extend props to forbid the `children` prop.
 * Use this to prevent accidentally passing `children` to components that
 * would silently throw them away.
 */
export type VoidProps<P = {}> = P & { children?: never };
/**
 * `VoidComponent` forbids the `children` prop.
 * Use this to prevent accidentally passing `children` to components that
 * would silently throw them away.
 */
export type VoidComponent<P = {}> = Component<VoidProps<P>>;

/**
 * Extend props to allow an optional `children` prop with the usual
 * type in JSX, `JSX.Element` (which allows elements, arrays, functions, etc.).
 * Use this for components that you want to accept children.
 */
export type ParentProps<P = {}> = P & { children?: JSX.Element };
/**
 * `ParentComponent` allows an optional `children` prop with the usual
 * type in JSX, `JSX.Element` (which allows elements, arrays, functions, etc.).
 * Use this for components that you want to accept children.
 */
export type ParentComponent<P = {}> = Component<ParentProps<P>>;

/**
 * Extend props to require a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 * Note that all JSX <Elements> are of the type `JSX.Element`.
 */
export type FlowProps<P = {}, C = JSX.Element> = P & { children: C };
/**
 * `FlowComponent` requires a `children` prop with the specified type.
 * Use this for components where you need a specific child type,
 * typically a function that receives specific argument types.
 * Note that all JSX <Elements> are of the type `JSX.Element`.
 */
export type FlowComponent<P = {}, C = JSX.Element> = Component<FlowProps<P, C>>;

/** @deprecated: use `ParentProps` instead */
export type PropsWithChildren<P = {}> = ParentProps<P>;

export type ValidComponent = keyof JSX.IntrinsicElements | Component<any> | (string & {});

/**
 * Takes the props of the passed component and returns its type
 *
 * @example
 * ComponentProps<typeof Portal> // { mount?: Node; useShadow?: boolean; children: JSX.Element }
 * ComponentProps<'div'> // JSX.HTMLAttributes<HTMLDivElement>
 */
export type ComponentProps<T extends ValidComponent> = T extends Component<infer P>
  ? P
  : T extends keyof JSX.IntrinsicElements
  ? JSX.IntrinsicElements[T]
  : Record<string, unknown>;

/**
 * Type of `props.ref`, for use in `Component` or `props` typing.
 *
 * @example Component<{ref: Ref<Element>}>
 */
export type Ref<T> = T | ((val: T) => void);

/**
 * 创建组件，函数式组件最终会被转移成 createComponent 函数
 */
export function createComponent<T>(Comp: Component<T>, props: T): JSX.Element {
  if (hydrationEnabled) {
    if (sharedConfig.context) {
      const c = sharedConfig.context;
      setHydrateContext(nextHydrateContext());
      const r = "_SOLID_DEV_"
        ? devComponent(Comp, props || ({} as T))
        : untrack(() => Comp(props || ({} as T)));
      setHydrateContext(c);
      return r;
    }
  }
  if ("_SOLID_DEV_") return devComponent(Comp, props || ({} as T));
  return untrack(() => Comp(props || ({} as T)));
}

function trueFn() {
  return true;
}

const propTraps: ProxyHandler<{
  get: (k: string | number | symbol) => any;
  has: (k: string | number | symbol) => boolean;
  keys: () => string[];
}> = {
  get(_, property, receiver) {
    if (property === $PROXY) return receiver;
    return _.get(property);
  },
  has(_, property) {
    if (property === $PROXY) return true;
    return _.has(property);
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(_, property) {
    return {
      configurable: true,
      enumerable: true,
      get() {
        return _.get(property);
      },
      set: trueFn,
      deleteProperty: trueFn
    };
  },
  ownKeys(_) {
    return _.keys();
  }
};

type DistributeOverride<T, F> = T extends undefined ? F : T;
type Override<T, U> = T extends any
  ? U extends any
    ? {
        [K in keyof T]: K extends keyof U ? DistributeOverride<U[K], T[K]> : T[K];
      } & {
        [K in keyof U]: K extends keyof T ? DistributeOverride<U[K], T[K]> : U[K];
      }
    : T & U
  : T & U;
type OverrideSpread<T, U> = T extends any
  ? {
      [K in keyof ({ [K in keyof T]: any } & { [K in keyof U]?: any } & {
        [K in U extends any ? keyof U : keyof U]?: any;
      })]: K extends keyof T
        ? Exclude<U extends any ? U[K & keyof U] : never, undefined> | T[K]
        : U extends any
        ? U[K & keyof U]
        : never;
    }
  : T & U;
type Simplify<T> = T extends any ? { [K in keyof T]: T[K] } : T;
type _MergeProps<T extends unknown[], Curr = {}> = T extends [
  infer Next | (() => infer Next),
  ...infer Rest
]
  ? _MergeProps<Rest, Override<Curr, Next>>
  : T extends [...infer Rest, infer Next | (() => infer Next)]
  ? Override<_MergeProps<Rest, Curr>, Next>
  : T extends []
  ? Curr
  : T extends (infer I | (() => infer I))[]
  ? OverrideSpread<Curr, I>
  : Curr;

export type MergeProps<T extends unknown[]> = Simplify<_MergeProps<T>>;

function resolveSource(s: any) {
  return !(s = typeof s === "function" ? s() : s) ? {} : s;
}

function resolveSources(this: (() => any)[]) {
  for (let i = 0, length = this.length; i < length; ++i) {
    const v = this[i]();
    if (v !== undefined) return v;
  }
}

export function mergeProps<T extends unknown[]>(...sources: T): MergeProps<T> {
  // [breaking && performance]
  //if (sources.length === 1) return sources[0] as any;
  let proxy = false;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    proxy = proxy || (!!s && $PROXY in (s as object));
    // 有函数（即 Signal（编译的时候，传递的 props 会对 Singal 做一层小代理））则做 proxy 代理，进行依赖监听
    sources[i] =
      typeof s === "function" ? ((proxy = true), createMemo(s as EffectFunction<unknown>)) : s;
  }
  // 有 Signal 的话，则走代理
  if (proxy) {
    // 通过 Proxy 坐一层代理，本质上还是访问原本的值
    return new Proxy(
      {
        get(property: string | number | symbol) {
        // 看这里的情况，是反过来读的，所以说，mergeProps 的时候，props 要放在最后
          for (let i = sources.length - 1; i >= 0; i--) {
            const v = resolveSource(sources[i])[property];
            if (v !== undefined) return v;
          }
        },
        has(property: string | number | symbol) {
          for (let i = sources.length - 1; i >= 0; i--) {
            if (property in resolveSource(sources[i])) return true;
          }
          return false;
        },
        keys() {
          const keys = [];
          for (let i = 0; i < sources.length; i++)
            keys.push(...Object.keys(resolveSource(sources[i])));
          return [...new Set(keys)];
        }
      },
      propTraps
    ) as unknown as MergeProps<T>;
  }

  // 如果 Props 没有 Signal 的话，则走正常对象合并即可
  const sourcesMap: Record<string, any[]> = {};
  const defined: Record<string, PropertyDescriptor | undefined> = Object.create(null);
  //let someNonTargetKey = false;

  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i] as Record<string, any>;
    if (!source) continue;
    const sourceKeys = Object.getOwnPropertyNames(source);
    //someNonTargetKey = someNonTargetKey || (i !== 0 && !!sourceKeys.length);
    for (let i = sourceKeys.length - 1; i >= 0; i--) {
      const key = sourceKeys[i];
      if (key === "__proto__" || key === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(source, key)!;
      if (!defined[key]) {
        defined[key] = desc.get
          ? {
              enumerable: true,
              configurable: true,
              get: resolveSources.bind((sourcesMap[key] = [desc.get.bind(source)]))
            }
          : desc.value !== undefined
          ? desc
          : undefined;
      } else {
        const sources = sourcesMap[key];
        if (sources) {
          if (desc.get) sources.push(desc.get.bind(source));
          else if (desc.value !== undefined) sources.push(() => desc.value);
        }
      }
    }
  }
  const target: Record<string, any> = {};
  const definedKeys = Object.keys(defined);
  for (let i = definedKeys.length - 1; i >= 0; i--) {
    const key = definedKeys[i],
      desc = defined[key];
    if (desc && desc.get) Object.defineProperty(target, key, desc);
    else target[key] = desc ? desc.value : undefined;
  }
  // [breaking && performance]
  //return (someNonTargetKey ? target : sources[0]) as any;
  return target as any;
}

export type SplitProps<T, K extends (readonly (keyof T)[])[]> = [
  ...{
    [P in keyof K]: P extends `${number}`
      ? Pick<T, Extract<K[P], readonly (keyof T)[]>[number]>
      : never;
  },
  { [P in keyof T as Exclude<P, K[number][number]>]: T[P] }
];

export function splitProps<
  T extends Record<any, any>,
  K extends [readonly (keyof T)[], ...(readonly (keyof T)[])[]]
>(props: T, ...keys: K): SplitProps<T, K> {
  if ($PROXY in props) {
    const blocked = new Set<keyof T>(keys.length > 1 ? keys.flat() : keys[0]);
    // 利用不同的 keys 进行划分，再通过 Proxy 进行区域划分
    const res = keys.map(k => {
      return new Proxy(
        {
          get(property) {
            return k.includes(property) ? props[property as any] : undefined;
          },
          has(property) {
            return k.includes(property) && property in props;
          },
          keys() {
            return k.filter(property => property in props);
          }
        },
        propTraps
      );
    });
    // 这里是 othersProps，用于未选择的 keys
    res.push(
      new Proxy(
        {
          get(property) {
            return blocked.has(property) ? undefined : props[property as any];
          },
          has(property) {
            return blocked.has(property) ? false : property in props;
          },
          keys() {
            return Object.keys(props).filter(k => !blocked.has(k));
          }
        },
        propTraps
      )
    );
    return res as SplitProps<T, K>;
  }

  // 同理，这边是不存在 Signal 或者说响应式的情况，直接对 props 或者说 不同对象对拆分处理
  const otherObject: Record<string, any> = {};
  const objects: Record<string, any>[] = keys.map(() => ({}));

  for (const propName of Object.getOwnPropertyNames(props)) {
    const desc = Object.getOwnPropertyDescriptor(props, propName)!;
    const isDefaultDesc =
      !desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable;
    let blocked = false;
    let objectIndex = 0;
    for (const k of keys) {
      if (k.includes(propName)) {
        blocked = true;
        isDefaultDesc
          ? (objects[objectIndex][propName] = desc.value)
          : Object.defineProperty(objects[objectIndex], propName, desc);
      }
      ++objectIndex;
    }
    if (!blocked) {
      isDefaultDesc
        ? (otherObject[propName] = desc.value)
        : Object.defineProperty(otherObject, propName, desc);
    }
  }
  return [...objects, otherObject] as any;
}

// lazy load a function component asynchronously
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<{ default: T }> } {
  let comp: () => T | undefined;
  let p: Promise<{ default: T }> | undefined;
  const wrap: T & { preload?: () => void } = ((props: any) => {
    const ctx = sharedConfig.context;
    if (ctx) {
      const [s, set] = createSignal<T>();
      sharedConfig.count || (sharedConfig.count = 0);
      sharedConfig.count++;
      (p || (p = fn())).then(mod => {
        setHydrateContext(ctx);
        sharedConfig.count!--;
        set(() => mod.default);
        setHydrateContext();
      });
      comp = s;
    } else if (!comp) {
      // lazy 会创建一个 createResource，用于资源加载
      // 这里的 createResource 会和 SuspenseContext 结合，用于资源加载完成前，显示 fallback
      const [s] = createResource<T>(() => (p || (p = fn())).then(mod => mod.default));
      comp = s;
    }
    let Comp: T | undefined;
    return createMemo(
      () =>
        // 只有等 createResource 资源加载完成后，Comp 才会被赋值，同时 Suspense 会显示 fallback
        (Comp = comp()) &&
        untrack(() => {
          if ("_SOLID_DEV_") Object.assign(Comp!, { [$DEVCOMP]: true });
          // 这里返回组件
          if (!ctx) return Comp!(props);
          const c = sharedConfig.context;
          setHydrateContext(ctx);
          const r = Comp!(props);
          setHydrateContext(c);
          return r;
        })
    ) as unknown as JSX.Element;
  }) as T;
  wrap.preload = () => p || ((p = fn()).then(mod => (comp = () => mod.default)), p);
  return wrap as T & { preload: () => Promise<{ default: T }> };
}

let counter = 0;
export function createUniqueId(): string {
  const ctx = sharedConfig.context;
  return ctx ? sharedConfig.getNextContextId() : `cl-${counter++}`;
}
