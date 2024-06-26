import { type EffectFn, effect } from './effect'
import { TriggerType, track, trigger } from './reactive'

// 计算属性
export const computed = (getter: EffectFn) => {
  // value 用来缓存上一次计算的值
  let value: any
  // dirty 用来标识是否需要重新计算
  let dirty = true

  const effectFn = effect(getter, {
    lazy: true,
    scheduler(effectFn) {
      dirty = true
      // 手动调用触发响应
      trigger(computedObj, 'value', TriggerType.SET)
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
