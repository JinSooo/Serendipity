import { type Effect, activeEffect, bucket } from './effect'

export type Key = string | symbol

export type Target = object

export enum TriggerType {
  SET = 'SET',
  ADD = 'ADD',
  DEL = 'DEL',
}

// ownKeys 获取一个对象的所有键值，不和任何键绑定，故设置一个唯一标识
const ITERATE_KEY = Symbol()

/**
 * 追踪 target 中 key 的变化 effect
 */
export const track = (target: Target, key: Key) => {
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
export const trigger = (target: Target, key: Key, type: TriggerType) => {
  const depsMap = bucket.get(target)
  if (!depsMap) return true
  const effects = depsMap.get(key)
  const iterateEffects = depsMap.get(ITERATE_KEY)

  const effectsToRun = new Set<Effect>()
  effects?.forEach(effectFn => {
    // 如果 trigger 触发的 effectFn 与当前正在执行的副作用函数相同，则不触发执行
    if (effectFn !== activeEffect) {
      effectsToRun.add(effectFn)
    }
  })

  // 对于 ITERATE_KEY 来说，仅用在添加属性活删除属性的时候，for...in的输出才会发生改变，才需要重新执行其副作用函数
  if (type === TriggerType.ADD || type === TriggerType.DEL) {
    // 获取与 ITERATE_KEY 相关的副作用函数
    iterateEffects?.forEach(effectFn => {
      // 如果 trigger 触发的 effectFn 与当前正在执行的副作用函数相同，则不触发执行
      if (effectFn !== activeEffect) {
        effectsToRun.add(effectFn)
      }
    })
  }

  effectsToRun.forEach(effectFn => {
    // 如果副作用函数存在调度器，则调用该调度器
    if (effectFn.options?.scheduler) {
      effectFn.options.scheduler(effectFn)
    } else {
      effectFn()
    }
  })
}

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
/**
 * 创建响应式对象
 * @param obj 代理对象
 * @param isShallow 浅响应
 * @param isReadonly 只读
 */
const createReactive = <T extends object>(obj: T, isShallow = false, isReadonly = false) => {
  return new Proxy<T>(obj, {
    get(target, key, receiver) {
      // 代理对象通过 raw 访问原始对象
      if (key === 'raw') {
        return target
      }

      // 非只读情况下才需要建立响应联系
      if (!isReadonly) {
        track(target, key)
      }

      const res = Reflect.get(target, key, receiver)
      // 浅响应
      if (isShallow) {
        return res
      }
      // 实现深响应
      if (typeof res === 'object' && res !== null) {
        // 深只读
        return isReadonly ? readonly(res) : reactive(res)
      }

      return res
    },
    set(target, key, newValue, receiver) {
      // 只读
      if (isReadonly) {
        console.warn(`property ${String(key)} is readonly!`)
        return true
      }

      const oldValue = target[key]
      // 如果存在该属性，则类型为设置，反之为添加
      const type = Object.prototype.hasOwnProperty.call(target, key) ? TriggerType.SET : TriggerType.ADD
      const res = Reflect.set(target, key, newValue, receiver)

      /**
       *  对于两个响应式对象，并通过 Object.setPrototypeOf(child, parent) 建立联系后
       *  如果 child 设置 parent 上的属性时，会触发 effect 的两次响应
       *  因为 child 和 parent 上分别 trigger 了一次，但这并不是 child 上的属性，而是代理对象 parent 的
       *  故可以通过 receiver 和 target 的判断，是否为原始对象的属性，进行甄别
       */
      if (target === receiver.raw) {
        /**
         *  值没有发生变化时，不需要触发响应
         *  特殊处理 NaN
         *  - NaN === NaN（false）
         *  - NaN !== NaN（true）
         */
        // biome-ignore lint/suspicious/noSelfCompare: <NaN>
        if (oldValue !== newValue && (oldValue === oldValue || newValue === newValue)) {
          trigger(target, key, type)
        }
      }

      return res
    },
    /**
     * 拦截 in、
     */
    has(target, key) {
      track(target, key)

      return Reflect.has(target, key)
    },
    /**
     * 拦截 for...in、
     */
    ownKeys(target) {
      track(target, ITERATE_KEY)

      return Reflect.ownKeys(target)
    },
    /**
     * 拦截 delete、
     */
    deleteProperty(target, key) {
      const hasKey = Object.prototype.hasOwnProperty.call(target, key)
      const res = Reflect.deleteProperty(target, key)

      if (res && hasKey) {
        trigger(target, key, TriggerType.DEL)
      }

      return res
    },
  })
}

/**
 * 创建响应式对象
 * @param obj 代理对象
 */
export const reactive = <T extends object>(obj: T) => {
  return createReactive<T>(obj)
}

/**
 * 创建浅响应式对象
 * @param obj 代理对象
 */
export const shallowReactive = <T extends object>(obj: T) => {
  return createReactive<T>(obj, true)
}

/**
 * 创建响应式只读对象
 * @param obj 代理对象
 */
export const readonly = <T extends object>(obj: T) => {
  return createReactive<T>(obj, false, true)
}

/**
 * 创建浅响应式只读对象
 * @param obj 代理对象
 */
export const shallowReadonly = <T extends object>(obj: T) => {
  return createReactive<T>(obj, true, true)
}
