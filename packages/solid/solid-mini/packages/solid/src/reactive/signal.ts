/* ------------------------------ Signal Types ------------------------------ */
type SignalComparator<T> = (prev: T, next: T) => boolean

interface SignalOptions<T> {
  /**
   * 比较函数，用于 Signal 更新时的比较
   */
  equals?: false | SignalComparator<T>
}

interface SignalState<T> {
  value: T

  /**
   * 存储所有观察此 Signal 的 observer 数组
   */
  observers: Computation<any>[] | null

  /**
   * Signal 在对应 observer 中 sources 里的下标
   *  - observers[i].sources[observerSlots[i]] -> 此 Signal
   *  - signal 和 effect 两者的 observers、sources、observerSlots、sourceSlots 是一一对应的
   */
  observerSlots: number[] | null

  /**
   * 比较函数
   */
  comparator?: SignalComparator<T>
}

type Accessor<T> = () => T

/**
 * 两种设置 Signal 的方式，一种 直接设置值，一种 传入一个函数，函数的返回值作为新的值
 */
type Setter<T> = {
  (value: T): T
  (value: (prev: T) => T): T
}

type Signal<T> = [get: Accessor<T>, set: Setter<T>]

/* ---------------------------- Computation Types --------------------------- */
type EffectFunction<T> = (v: T) => T

/**
 * Computation 的状态
 */
enum ComputationState {
  /**
   * 未初始化
   */
  UNSET = 0,

  /**
   * 过期，需要更新（即 Signal 更新后，对应的 Computation 需要重新计算）
   */
  STALE = 1,
}

interface Computation<T> {
  /**
   * 副作用函数
   */
  fn: EffectFunction<T>

  /**
   * 当前状态
   */
  state: ComputationState

  /**
   * 依赖收集，存储所有此副作用函数里使用到的 Signal
   */
  sources: SignalState<T>[] | null

  /**
   * Computation 在对应 sources 中 observers 里的下标
   *  - sources[i].observers[sourceSlots[i]] -> 此 Computation
   *  - signal 和 effect 两者的 observers、sources、observerSlots、sourceSlots 是一一对应的
   */
  sourceSlots: number[] | null

  /**
   * 用于 createMemo 这种特殊的 Computation，存在返回值
   */
  value?: T
}

/* ------------------------------- Memo Types ------------------------------- */
interface Memo<T> extends SignalState<T>, Computation<T> {
  /**
   * 重置 Signal 和 Computation 的 value 值
   */
  value: T
}

/* ----------------------------- Global Variable ---------------------------- */
/**
 * Listener 指向当前正在执行的 Computation，用于后续依赖收集
 */
let Listener: Computation<any> | null = null
/**
 * Computation 更新队列
 */
let Effects: Computation<any>[] | null = null

/* --------------------------------- Signal --------------------------------- */
const equalFn = <T>(a: T, b: T) => a === b
/**
 * Signal 默认 options 配置
 */
const signalOptions = { equals: equalFn }

/**
 * 创建一个 Signal（响应式状态）
 * @param value 初始化值
 * @param options 可选配置
 * @returns
 * ```typescript
 * [getter: Accessor<T>, setter: Setter<T>]
 * ```
 */
export function createSignal<T>(value?: T, options?: SignalOptions<T | undefined>): Signal<T | undefined> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions

  // 初始化 Signal 对象
  const signal: SignalState<T | undefined> = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined,
  }
  console.log('🚀 ~ signal:', signal)

  const getter: Accessor<T | undefined> = readSignal.bind(signal)
  const setter: Setter<T | undefined> = (value?: unknown) => {
    // 对于函数的话，函数的返回值作为新的值
    if (typeof value === 'function') {
      value = value(signal.value)
    }
    return writeSignal(signal, value)
  }

  return [getter, setter]
}

function readSignal(this: SignalState<any>) {
  // 对 memo 的特殊处理
  // 如果读取的时候，memo 的状态是 STALE，那么需要先更新其 value，再返回结果
  if ((this as Memo<any>).sources && (this as Memo<any>).state === ComputationState.STALE) {
    updateComputation(this as Memo<any>)
  }

  /**
   * 如果是在 Computation 中调用的 Signal 的话，则启用依赖收集
   */
  if (Listener) {
    const sourceSlot = this.observers ? this.observers.length : 0
    if (Listener.sources && Listener.sourceSlots) {
      Listener.sources.push(this)
      Listener.sourceSlots.push(sourceSlot)
    } else {
      Listener.sources = [this]
      Listener.sourceSlots = [sourceSlot]
    }

    const observerSlot = Listener.sources.length - 1
    if (this.observers && this.observerSlots) {
      this.observers.push(Listener)
      this.observerSlots.push(observerSlot)
    } else {
      this.observers = [Listener]
      this.observerSlots = [observerSlot]
    }
  }

  return this.value
}

function writeSignal(node: SignalState<any>, value: any) {
  /**
   * 比较判断，是否需要更新
   */
  if (!node.comparator || !node.comparator(node.value, value)) {
    node.value = value

    if (node.observers && node.observers.length > 0) {
      runUpdates(() => {
        for (let i = 0; i < node.observers!.length; i++) {
          const observer = node.observers![i]

          if (observer.state === ComputationState.UNSET) {
            Effects?.push(observer)
            // 省略掉 memo 再走一次 runEffects 的逻辑
            // ;(observer as Memo<any>).observers && markDownstream(observer as Memo<any>)
          }
          observer.state = ComputationState.STALE
        }
      })
    }
  }

  return value
}

/* ------------------------------- Computation ------------------------------ */
/**
 * 创建一个副作用处理函数
 * @desc Solid 对它的解释是: 创建一个在跟踪范围内运行给定函数的 Computation，从而自动跟踪其依赖项，并在依赖项更新时自动重新运行该函数。
 * @param fn 副作用函数
 */
export function createEffect<T>(fn: EffectFunction<T>, value?: T): void {
  const computation = createComputation(fn, value!, ComputationState.STALE)
  console.log('🚀 ~ computation:', computation)

  // 前半段存在的逻辑，一种情况是在更新的过程中，一个 effect 嵌入了另一个 effect
  Effects ? Effects.push(computation) : updateComputation(computation)
}

/**
 * Computation 工厂函数
 * @param fn 计算函数
 * @param fn 初始值
 * @param state Computation 状态
 */
function createComputation<T>(fn: EffectFunction<T>, init: T, state: ComputationState): Computation<T> {
  const computation: Computation<T> = {
    fn,
    state,
    value: init,
    sources: null,
    sourceSlots: null,
  }

  return computation
}

/**
 * 清除 Computation 的依赖追踪关系，并重置其状态
 * @param node Computation
 */
function cleanComputation(node: Computation<any>) {
  if (node.sources) {
    // 找到当前 Computation 的所有依赖，并取消其依赖关系
    while (node.sources!.length) {
      const source = node.sources!.pop()! as SignalState<any>
      const index = node.sourceSlots!.pop()!
      const observers = source.observers

      // 如果 observers 不存在，那么 pop 出来的那一个就是当前 Computation
      // 反之，用 observers 的最后一位去覆盖当前需要清除的 Computation
      if (observers && observers.length > 0) {
        const observer = observers.pop()!
        const slot = source.observerSlots!.pop()!

        if (index < observers.length) {
          observer.sourceSlots![slot] = index
          observers[index] = observer
          source.observerSlots![index] = slot
        }
      }
    }
  }

  node.state = ComputationState.UNSET
}

/**
 * 更新 Computation
 */
function updateComputation(node: Computation<any>) {
  if (!node.fn) return

  cleanComputation(node)
  runComputation(node, node.value)
}

/**
 * 执行 Computation
 */
function runComputation(node: Computation<any>, value: any) {
  // 这里的 Listener 是为了在 runComputation 执行完之后能够恢复之前的 Listener
  // 如果 runComputation 存在递归的话，那么 listener 实际上也会形成一个递归栈，来存储每一个 prev Listener
  const listener = Listener
  // 指向当前正在指向的 Computation
  Listener = node
  let newValue: any

  try {
    newValue = node.fn(value)
  } finally {
    // 恢复为之前的
    Listener = listener
  }

  // 对于 memo 的特殊处理
  // 这里不能单纯通过 node.observers 去判断，需要判断 node.observers 属性是否存在
  if ('observers' in node) {
    // 通知 memo signal 的依赖项更新
    writeSignal(node as Memo<any>, newValue)
  }
  node.value = newValue
}

/**
 * 创建一个副作用处理函数
 * @desc Solid 对它的解释是: 创建一个在跟踪范围内运行给定函数的 Computation，从而自动跟踪其依赖项，并在依赖项更新时自动重新运行该函数。
 * @param fn 副作用函数
 */
export function createMemo<T>(fn: EffectFunction<T>, value?: T, options?: SignalOptions<T>): Accessor<T> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions

  const memo: Partial<Memo<T>> = createComputation(fn, value!, ComputationState.STALE)
  console.log('🚀 ~ memo:', memo)

  // 添加 Signal 的属性
  memo.observers = null
  memo.observerSlots = null
  memo.comparator = options.equals || undefined

  updateComputation(memo as Memo<T>)

  return readSignal.bind(memo as Memo<T>)
}

/**
 * memo Signal态，递归向上查找 递归 memo effect，并通知更新
 * 用于 memo 的递归查找相关 effect
 * 查找当前 node(effect) 的所有 signal，如果 signal 是 memo signal，则继续递归查找
 */
function lookUpstream(node: Computation<any>) {
  node.state = ComputationState.UNSET
  for (let i = 0; i < node.sources!.length; i += 1) {
    const source = node.sources![i] as Memo<any>
    if (source.sources) {
      if (source.state === ComputationState.STALE) {
        updateComputation(source)
      }
    }
  }
}

/**
 * memo Computation态，向下查找 memo 的 observers，并通知更新，同时递归向下查找 memo(observer) 下游
 */
function markDownstream(node: Memo<any>) {
  for (let i = 0; i < node.observers!.length; i += 1) {
    const observer = node.observers![i]
    if (observer.state === ComputationState.UNSET) {
      observer.state = ComputationState.STALE
      Effects!.push(observer)
      ;(observer as Memo<any>).observers && markDownstream(observer as Memo<any>)
    }
  }
}

/* --------------------------------- Updates -------------------------------- */
/**
 * 走更新队列，对于多个 Computation 更新，会统一先加入到队列中，最后统一执行
 * @param fn 更新函数
 */
function runUpdates<T>(fn: () => T) {
  let wait = false
  // 如果 Effects 存在，说明之前已经有触发了一次 runUpdates 了，
  // 接下来后面的只需要将需要更新的 Computation 加入到 Effects 当中即可，由状态 wait 标明是否标志需要等待
  if (Effects) wait = true
  else Effects = []

  try {
    const res = fn()
    completeUpdates(wait)
    return res
  } catch (err) {
    if (!wait) Effects = null
  }
}

function completeUpdates(wait: boolean) {
  // 这里的 wait 就是根据前面 runUpdates 判断，是否是第一次 runUpdates，
  // 后续的 runUpdates 只需要将更新内容加入到 Effects，最后由第一次 runUpdates 统一执行 completeUpdates
  if (wait) return

  // 执行到这里，标识所有需要更新的 Computation 都已加入到更新队列 Effects
  const e = Effects!
  // 更新完成后，清空更新队列，准备下一次更新
  Effects = null
  // 暂时简单一点处理，直接执行 runEffects
  // if (e!.length) runUpdates(() => runEffects(e))
  if (e!.length) {
    console.log('update')
    runEffects(e)
  }
}

function runEffects(effects: Computation<any>[]) {
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]
    // 标明 signal 已经更新，对应的 effect 需要重新计算
    if (effect.state === ComputationState.STALE) {
      updateComputation(effect)
    }
  }
}
