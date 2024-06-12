type EffectFn = () => void

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

// 全局变量存储被注册的副作用函数
let activeEffect: EffectFn
const effect = (fn: EffectFn) => {
  activeEffect = fn
  // 执行函数以被Proxy拦截，进行追踪操作
  fn()
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

  deps.add(activeEffect)
}

/**
 * 拦截 target 中 key 的修改，并触发变化 effect
 */
const trigger = (target: Target, key: Key) => {
  const depsMap = bucket.get(target)
  if (!depsMap) return true
  const effects = depsMap.get(key)
  effects?.forEach(fn => fn())
}

const data = { ok: true, text: 'hello' }

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
  console.log(obj.ok)
})
effect(() => {
  console.log(obj.text)
})

setTimeout(() => {
  obj.ok = false
}, 1000)
