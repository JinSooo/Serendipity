interface SignalOptions<T> {
  equals?: false | ((prev: T, next: T) => boolean)
}

interface SignalState<T> {
  value: T
  observers: Computation<any>[] | null
  observerSlots: number[] | null
  comparator?: (prev: T, next: T) => boolean
}

type Accessor<T> = () => T

type Setter<T> = {
  (value: T): T
  (value: (prev: T) => T): T
}

type Signal<T> = [get: Accessor<T>, set: Setter<T>]

// type EffectFunction<Prev, Next extends Prev = Prev> = (v: Prev) => Next
type EffectFunction = () => void

enum ComputationState {
  UNSET = 0,
  STALE = 1,
  PENDING = 2,
}

interface Computation<Init, Next extends Init = Init> {
  fn: EffectFunction
  state: ComputationState
  sources: SignalState<Next>[] | null
  sourceSlots: number[] | null
}

let Listener: Computation<any> | null = null
let Effects: Computation<any>[] | null = null

const equalFn = <T>(a: T, b: T) => a === b
const signalOptions = { equals: equalFn }

export function createSignal<T>(value?: T, options?: SignalOptions<T | undefined>): Signal<T | undefined> {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions

  const signal: SignalState<T | undefined> = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined,
  }

  const getter: Accessor<T | undefined> = readSignal.bind(signal)
  const setter: Setter<T | undefined> = (value?: unknown) => {
    if (typeof value === 'function') {
      value = value(signal.value)
    }
    return writeSignal(signal, value)
  }

  return [getter, setter]
}

function readSignal(this: SignalState<any>) {
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
  if (!node.comparator || !node.comparator(node.value, value)) {
    node.value = value

    if (node.observers && node.observers.length > 0) {
      runUpdates(() => {
        for (let i = 0; i < node.observers!.length; i++) {
          const observer = node.observers![i]

          if (observer.state === ComputationState.UNSET) {
            Effects?.push(observer)
          }
          observer.state = ComputationState.STALE
        }
      })
    }
  }

  return value
}

export function createEffect<Next, Init>(fn: EffectFunction): void {
  const computation = createComputation(fn, ComputationState.STALE)

  Effects ? Effects.push(computation) : updateComputation(computation)
}

function createComputation<Next, Init = unknown>(
  fn: EffectFunction,
  state: ComputationState,
): Computation<Init | Next, Next> {
  const computation: Computation<Init | Next, Next> = {
    fn,
    state,
    sources: null,
    sourceSlots: null,
  }

  return computation
}

function cleanNode(node: Computation<any>) {
  if (node.sources) {
    while (node.sources!.length) {
      const source = node.sources!.pop()! as SignalState<any>
      const index = node.sourceSlots!.pop()!
      const observers = source.observers

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

function updateComputation(node: Computation<any>) {
  if (!node.fn) return

  cleanNode(node)

  runComputation(node)
}

function runComputation(node: Computation<any>) {
  const listener = Listener
  Listener = node

  try {
    node.fn()
  } finally {
    // 恢复为之前的
    Listener = listener
  }
}

function runUpdates<T>(fn: () => T) {
  let wait = false
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
  if (wait) return

  const e = Effects!
  Effects = null
  if (e!.length) runUpdates(() => runEffects(e))
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
