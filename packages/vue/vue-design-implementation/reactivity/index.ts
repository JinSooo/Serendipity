interface EffectOptions {
  /**
   * 懒执行
   */
  lazy?: boolean

  /**
   * 调度器
   */
  scheduler?(effectFn: Effect): void
}

type EffectFn = () => any

interface Effect {
  (): any
  deps?: Array<Set<Effect>>
  options?: EffectOptions
}

type Key = string | symbol

type Target = object

/**
 * bucket (WeakMap)
 *   |
 *    ——  target (Map)
 *          |
 *            ——  key (Set)
 *                  |
 *                    ——  effects (Set)
 *    ——  target (Map)
 *          |
 *            ——  key (Set)
 *                  |
 *                    ——  effects (Set)
 */
const bucket = new WeakMap<Target, Map<Key, Set<EffectFn>>>()

// 清除副作用函数依赖
const cleanup = (effectFn: Effect) => {
  effectFn.deps!.forEach(deps => {
    deps.delete(effectFn)
  })
  effectFn.deps!.length = 0
}

// 全局变量存储被注册的副作用函数
let activeEffect: Effect
// effect 栈，用来存储嵌套 effectFn
const effectStack: Array<EffectFn> = []
const effect = (fn: EffectFn, options: EffectOptions = {}) => {
  const effectFn = () => {
    cleanup(effectFn)
    activeEffect = effectFn
    // 在调用副作用函数前，将当前副作用函数压入栈中
    effectStack.push(effectFn)
    // 执行函数以被Proxy拦截，进行追踪操作
    const res = fn()
    // 在函数执行完毕后，将当前副作用函数弹出栈
    effectStack.pop()
    // 恢复之前的 effectFn 值
    activeEffect = effectStack[effectStack.length - 1]
    return res
  }

  effectFn.options = options
  // 用来存储所有与该副作用函数相关联的依赖集合
  effectFn.deps = []
  // 懒加载
  if (!options.lazy) {
    effectFn()
  }
  // 返回副作用函数供自行调用
  return effectFn
}

// 计算属性
const computed = (getter: EffectFn) => {
  // value 用来缓存上一次计算的值
  let value: any
  // dirty 用来标识是否需要重新计算
  let dirty = true

  const effectFn = effect(getter, {
    lazy: true,
    scheduler(effectFn) {
      dirty = true
      // 手动调用触发响应
      trigger(computedObj, 'value')
      effectFn()
    },
  })

  // 对 computedObj 进行响应式处理
  const computedObj = {
    get value() {
      if (dirty) {
        value = effectFn()
        dirty = false
      }

      // 手动进行追踪
      track(computedObj, 'value')

      return value
    },
  }

  return computedObj
}

/**
 * 递归遍历 value 中的所有属性
 */
const traverse = (value: any, seen = new Set()) => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return

  seen.add(value)
  for (const key in value) {
    traverse(value[key], seen)
  }

  return value
}

interface WatchOptions {
  /**
   * 立即执行
   */
  immediate?: boolean

  /**
   * 执行时机
   */
  flush?: 'pre' | 'post' | 'sync'
}

const watch = (source: any, cb: (newValue, oldValue, onInvalidate) => void, options: WatchOptions = {}) => {
  let getter: () => any
  // 函数的形式指定监听特定的值
  if (typeof source === 'function') {
    getter = source
  } else {
    getter = () => traverse(source)
  }

  // 记录新旧值
  let oldValue: any
  let newValue: any

  // cleanup 用于存储用户的过期回调
  let cleanup: () => void
  const onInvalidate = (fn: () => void) => {
    cleanup = fn
  }

  const job = () => {
    // 执行过期回调
    cleanup?.()

    // 重新执行副作用函数拿到最新值
    newValue = effectFn()
    cb(newValue, oldValue, onInvalidate)
    oldValue = newValue
  }

  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler() {
      if (options.flush === 'post') {
        Promise.resolve().then(job)
      } else {
        job()
      }
    },
  })

  if (options.immediate) {
    job()
  } else {
    // 手动调用副作用函数，拿到初始值
    oldValue = effectFn()
  }
}

/**
 * 追踪 target 中 key 的变化 effect
 */
const track = (target: Target, key: Key) => {
  if (!activeEffect) return

  let depsMap = bucket.get(target)
  if (!depsMap) {
    depsMap = new Map()
    bucket.set(target, depsMap)
  }

  let deps = depsMap.get(key)
  if (!deps) {
    deps = new Set()
    depsMap.set(key, deps)
  }

  // 添加副作用函数到 deps 和 activeEffect.deps 集合
  deps.add(activeEffect)
  activeEffect.deps!.push(deps)
}

/**
 * 拦截 target 中 key 的修改，并触发变化 effect
 */
const trigger = (target: Target, key: Key) => {
  const depsMap = bucket.get(target)
  if (!depsMap) return true
  const effects = depsMap.get(key)

  const effectsToRun = new Set<Effect>()
  effects?.forEach(effectFn => {
    // 如果 trigger 触发的 effectFn 与当前正在执行的副作用函数相同，则不触发执行
    if (effectFn !== activeEffect) {
      effectsToRun.add(effectFn)
    }
  })

  effectsToRun.forEach(effectFn => {
    // 如果副作用函数存在调度器，则调用该调度器
    if (effectFn.options?.scheduler) {
      effectFn.options.scheduler(effectFn)
    } else {
      effectFn()
    }
  })
}

const data = { ok: true, text: 'hello', count: 0 }

/**
 * Reflect 方式和 原生获取(target[key]) 的区别
 * @example 以这个对象为例子
 *  const obj = {
 *    foo: 1,
 *    get bar() {
 *      return this.foo
 *    }
 *  }
 * @desc
 * - 当代理对象p后，在effect中调用 p.bar，会发现并没有建立联系，因为 p.bar 内部会调用 this.foo，
 *   导致最终获取的方式为 obj.foo，即原始对象的属性，并不是代理对象的
 *   最终导致既不能建立联系，也不能响应
 *
 * 最后通过 Reflect.get 的第三个参数 receiver，去控制谁在读取属性
 */
const obj = new Proxy(data, {
  get(target, key, receiver) {
    if (!activeEffect) return

    track(target, key)

    return Reflect.get(target, key, receiver)
  },
  set(target, key, newValue, receiver) {
    target[key] = newValue

    trigger(target, key)

    return Reflect.set(target, key, newValue, receiver)
  },
})

const sum = computed(() => (obj.ok ? obj.text.length : 0))

watch(obj, () => {
  console.log('obj changed')
})

watch(
  () => obj.count,
  (newValue, oldValue) => {
    console.log('obj count changed', newValue, oldValue)
  },
)

console.log('finished')
obj.count = 2
