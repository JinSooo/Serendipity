interface EffectOption {
  lazy?: boolean

  scheduler?(effectFn: Effect): void
}

type EffectFn = () => any

interface Effect {
  (): any
  deps?: Array<Set<Effect>>
  options?: EffectOption
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
const effect = (fn: EffectFn, options: EffectOption = {}) => {
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

const obj = new Proxy(data, {
  get(target, key, receiver) {
    if (!activeEffect) return

    track(target, key)

    return target[key]
  },
  set(target, key, newValue, receiver) {
    target[key] = newValue

    trigger(target, key)

    return true
  },
})

const sum = computed(() => (obj.ok ? obj.text.length : 0))

effect(() => console.log(`+${sum.value}`))

console.log(sum.value)
obj.ok = false
console.log(sum.value)
console.log('finished')
