interface EffectFn {
  (): void
  deps?: Array<Set<EffectFn>>
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
const cleanup = (effectFn: EffectFn) => {
  effectFn.deps!.forEach(deps => {
    deps.delete(effectFn)
  })
  effectFn.deps!.length = 0
}

// 全局变量存储被注册的副作用函数
let activeEffect: EffectFn
// effect 栈，用来存储嵌套 effectFn
const effectStack: Array<EffectFn> = []
const effect = (fn: EffectFn) => {
  const effectFn = () => {
    cleanup(effectFn)
    activeEffect = effectFn
    // 在调用副作用函数前，将当前副作用函数压入栈中
    effectStack.push(effectFn)
    // 执行函数以被Proxy拦截，进行追踪操作
    fn()
    // 在函数执行完毕后，将当前副作用函数弹出栈
    effectStack.pop()
    // 恢复之前的 effectFn 值
    activeEffect = effectStack[effectStack.length - 1]
  }

  // 用来存储所有与该副作用函数相关联的依赖集合
  effectFn.deps = []
  effectFn()
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

  const effectsToRun = new Set<EffectFn>()
  effects?.forEach(effectFn => {
    // 如果 trigger 触发的 effectFn 与当前正在执行的副作用函数相同，则不触发执行
    if (effectFn !== activeEffect) {
      effectsToRun.add(effectFn)
    }
  })

  effectsToRun.forEach(effectFn => effectFn())
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

effect(() => {
  console.log('effectFn1 run')

  obj.count++
})
