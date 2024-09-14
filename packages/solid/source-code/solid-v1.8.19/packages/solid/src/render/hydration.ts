import { Computation } from "../reactive/signal.js";

export type HydrationContext = { id: string; count: number };

/**
 * SSR 时，浏览器和服务器之前共享的内容
 * 换句话说，服务器注入时会带上这些数据传递给浏览器，但是会通过特殊标识（_$HY, [data-hk]）去传递
 */
type SharedConfig = {
  /**
   * HydrationContext 类型,包含 id 和 count。用于跟踪 hydration 的上下文信息
   */
  context?: HydrationContext;

  /**
   * 用于存储资源。可能包括异步加载的组件或数据
   */
  resources?: { [key: string]: any };

  /**
   * 用于加载资源的函数
   */
  load?: (id: string) => Promise<any> | any;

  /**
   * 用于检查资源是否已加载的函数
   */
  has?: (id: string) => boolean;

  /**
   * 用于收集资源的函数
   */
  gather?: (key: string) => void;

  /**
   * 用于存储所有需要 hydrate 的节点，在 hydration 时，进行节点复用
   */
  registry?: Map<string, Element>;

  /**
   * 用于标记 hydration 是否完成的标志
   */
  done?: boolean;

  /**
   * 用于跟踪 effects 的计数器
    当 count 为真（非零）时，它表示 hydration 过程仍在进行中，还有更多的元素或组件需要处理。
    当 count 为假（零）时，它可能表示当前批次的 hydration 已经完成。
    count 可能在处理每个需要 hydration 的元素或组件时递减
   */
  count?: number;

  /**
   * 用于存储 effects 的数组
   */
  effects?: Computation<any, any>[];

  /**
   * 用于生成 contextId 的函数
   */
  getContextId(): string;

  /**
   * 用于生成下一个 contextId 的函数
   */
  getNextContextId(): string;
};

export const sharedConfig: SharedConfig = {
  context: undefined,
  registry: undefined,
  getContextId() {
    return getContextId(this.context!.count);
  },
  getNextContextId() {
    return getContextId(this.context!.count++);
  }
};

function getContextId(count: number) {
  const num = String(count),
    len = num.length - 1;
  return sharedConfig.context!.id + (len ? String.fromCharCode(96 + len) : "") + num;
}

export function setHydrateContext(context?: HydrationContext): void {
  sharedConfig.context = context;
}

export function nextHydrateContext(): HydrationContext | undefined {
  return {
    ...sharedConfig.context,
    id: sharedConfig.getNextContextId(),
    count: 0
  };
}
