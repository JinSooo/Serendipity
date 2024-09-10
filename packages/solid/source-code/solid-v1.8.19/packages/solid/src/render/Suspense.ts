import { createComponent } from "./component.js";
import {
  createRoot,
  createSignal,
  createContext,
  useContext,
  getSuspenseContext,
  resumeEffects,
  createMemo,
  Accessor,
  onCleanup,
  getOwner
} from "../reactive/signal.js";
import { HydrationContext, setHydrateContext, sharedConfig } from "./hydration.js";
import type { JSX } from "../jsx.js";

type SuspenseListContextType = {
  register: (inFallback: Accessor<boolean>) => Accessor<SuspenseListRegisteredState>;
};

type SuspenseListRegisteredState = { showContent: boolean; showFallback: boolean };
interface SuspenseListState extends Array<SuspenseListRegisteredState> {
  inFallback: boolean;
}

const suspenseListEquals = (a: SuspenseListRegisteredState, b: SuspenseListRegisteredState) =>
  a.showContent === b.showContent && a.showFallback === b.showFallback;
const SuspenseListContext = /* #__PURE__ */ createContext<SuspenseListContextType>();

/**
 * **[experimental]** Controls the order in which suspended content is rendered
 *
 * @description https://docs.solidjs.com/reference/components/suspense-list
 */
export function SuspenseList(props: {
  children: JSX.Element;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  let [wrapper, setWrapper] = createSignal(() => ({ inFallback: false })),
    show: Accessor<{ showContent: boolean; showFallback: boolean }>;

  // Nested SuspenseList support
  const listContext = useContext(SuspenseListContext);
  const [registry, setRegistry] = createSignal<Accessor<boolean>[]>([]);
  if (listContext) {
    show = listContext.register(createMemo(() => wrapper()().inFallback));
  }
  const resolved = createMemo<SuspenseListState>(
    (prev: Partial<SuspenseListState>) => {
      const reveal = props.revealOrder,
        tail = props.tail,
        { showContent = true, showFallback = true } = show ? show() : {},
        reg = registry(),
        reverse = reveal === "backwards";

      if (reveal === "together") {
        const all = reg.every(inFallback => !inFallback());
        const res: SuspenseListState = reg.map(() => ({
          showContent: all && showContent,
          showFallback
        })) as SuspenseListState;
        res.inFallback = !all;
        return res;
      }

      let stop = false;
      let inFallback = prev.inFallback as boolean;
      const res: SuspenseListState = [] as any;
      for (let i = 0, len = reg.length; i < len; i++) {
        const n = reverse ? len - i - 1 : i,
          s = reg[n]();
        if (!stop && !s) {
          res[n] = { showContent, showFallback };
        } else {
          const next = !stop;
          if (next) inFallback = true;
          res[n] = {
            showContent: next,
            showFallback: !tail || (next && tail === "collapsed") ? showFallback : false
          };
          stop = true;
        }
      }
      if (!stop) inFallback = false;
      res.inFallback = inFallback;
      return res;
    },
    { inFallback: false } as unknown as SuspenseListState
  );
  setWrapper(() => resolved);

  return createComponent(SuspenseListContext.Provider, {
    value: {
      register: (inFallback: Accessor<boolean>) => {
        let index: number;
        setRegistry(registry => {
          index = registry.length;
          return [...registry, inFallback];
        });
        return createMemo(() => resolved()[index], undefined, {
          equals: suspenseListEquals
        });
      }
    },
    get children() {
      return props.children;
    }
  });
}

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 * ```typescript
 * const AsyncComponent = lazy(() => import('./component'));
 *
 * <Suspense fallback={<LoadingIndicator />}>
 *   <AsyncComponent />
 * </Suspense>
 * ```
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let counter = 0,
    show: Accessor<SuspenseListRegisteredState>,
    ctx: HydrationContext | undefined,
    p: Promise<any> | any,
    flicker: Accessor<void> | undefined,
    error: any;
  const [inFallback, setFallback] = createSignal<boolean>(false),
    SuspenseContext = getSuspenseContext(),
    // 结合 SuspenseContext，所存储的状态信息
    /**
      关于 increment 和 decrement 以及 effects 的状态更新，是位于 createResource 中
      effects 用于组件初始化时，但资源还未加载完成，将 effect 存储到 SuspenseContext 当中
     */
      /**
        可以看看上面的案例，Suspense 内部加载了一个 lazy 组件
        1. Suspense 创建了一个 SuspenseContext.Provider，并传递了 store 对象
        2. lazy 组件中会创建一个 createResource，会读取 SuspenseContext 中的状态，并根据资源的状态，执行 increment 和 decrement
        3.1. 当资源加载完成时，会更新组件，执行组件，会将组件内的 effects 加入到 store.effects 中等待处理
        3.2. 再执行 decrement，通知 SuspenseContext 状态改变，然后 Suspense 会重新渲染
       */
    store = {
      increment: () => {
        if (++counter === 1) setFallback(true);
      },
      decrement: () => {
        if (--counter === 0) setFallback(false);
      },
      inFallback,
      effects: [],
      resolved: false
    },
    owner = getOwner();
  if (sharedConfig.context && sharedConfig.load) {
    const key = sharedConfig.getContextId();
    let ref = sharedConfig.load(key);
    if (ref) {
      if (typeof ref !== "object" || ref.status !== "success") p = ref;
      else sharedConfig.gather!(key);
    }
    if (p && p !== "$$f") {
      const [s, set] = createSignal(undefined, { equals: false });
      flicker = s;
      p.then(
        () => {
          if (sharedConfig.done) return set();
          sharedConfig.gather!(key);
          setHydrateContext(ctx);
          set();
          setHydrateContext();
        },
        (err: any) => {
          error = err;
          set();
        }
      );
    }
  }

  // SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) show = listContext.register(store.inFallback);
  let dispose: undefined | (() => void);
  onCleanup(() => dispose && dispose());

  // 实质返回的是一个 SuspenseContext.Provider 组件，然后根据状态信息，决定是否渲染 children
  return createComponent(SuspenseContext.Provider, {
    value: store,
    get children() {
      // 第一次 memo 创建了一个 rendered，什么时候渲染， 交给第二次 memo 决定
      return createMemo(() => {
        if (error) throw error;
        ctx = sharedConfig.context!;
        if (flicker) {
          flicker();
          return (flicker = undefined);
        }
        if (ctx && p === "$$f") setHydrateContext();
        // 这里创建了一个 memo，用于缓存 props.children，并进行监听
        const rendered = createMemo(() => props.children);
        // 第二层 memo，根据状态信息，决定是否渲染 children，还是显示 fallback
        return createMemo((prev: JSX.Element) => {
          const inFallback = store.inFallback(),
            { showContent = true, showFallback = true } = show ? show() : {};
          // 如果内容加载完成，则渲染 children
          if ((!inFallback || (p && p !== "$$f")) && showContent) {
            store.resolved = true;
            dispose && dispose();
            dispose = ctx = p = undefined;
            resumeEffects(store.effects);
            // 返回 render 结果
            return rendered();
          }
          if (!showFallback) return;
          // 这里的 dispose 算是判断是否已经渲染过 fallback，如果渲染过，则不重复渲染
          if (dispose) return prev;
          // 如果内容未加载完成，显示 fallback
          return createRoot(disposer => {
            dispose = disposer;
            if (ctx) {
              setHydrateContext({ id: ctx.id + "F", count: 0 });
              ctx = undefined;
            }
            return props.fallback;
          }, owner!);
        });
      }) as unknown as JSX.Element;
    }
  });
}
