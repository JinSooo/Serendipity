import type { Key, Target } from './reactive'

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

export type EffectFn = () => any

export interface Effect {
  (): any
  deps?: Array<Set<Effect>>
  options?: EffectOptions
}

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
export const bucket = new WeakMap<Target, Map<Key, Set<EffectFn>>>()

// 清除副作用函数依赖
const cleanup = (effectFn: Effect) => {
  effectFn.deps!.forEach(deps => {
    deps.delete(effectFn)
  })
  effectFn.deps!.length = 0
}

// 全局变量存储被注册的副作用函数
export let activeEffect: Effect

// effect 栈，用来存储嵌套 effectFn
const effectStack: Array<EffectFn> = []

export const effect = (fn: EffectFn, options: EffectOptions = {}) => {
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
