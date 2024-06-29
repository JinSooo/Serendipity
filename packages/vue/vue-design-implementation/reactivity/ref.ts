import { reactive } from './reactive'

/**
 * 原始值的响应式
 */
export const ref = <T>(value: T) => {
  const wrapper = {
    value,
  }

  // 定义一个不可枚举的属性，标识 ref
  Object.defineProperty(wrapper, '__v_isRef', {
    value: true,
  })

  return reactive(wrapper)
}

/**
 * 返回一个类似于 ref 结构的 wrapper 对象，解决响应式丢失问题
 * TODO: 类型提示
 */
export const toRef = (obj, key) => {
  const wrapper = {
    get value() {
      return obj[key]
    },
    set value(val) {
      obj[key] = val
    },
  }

  // 定义一个不可枚举的属性，标识 ref
  Object.defineProperty(wrapper, '__v_isRef', {
    value: true,
  })

  return wrapper
}

/**
 * 对整个对象 ref 化
 * TODO: 类型提示
 */
export const toRefs = obj => {
  const wrapper = {}

  for (const key in obj) {
    wrapper[key] = toRef(obj, key)
  }

  return wrapper
}

/**
 * 为 ref 化的对象实现自动脱 ref
 */
export const proxyRefs = <T extends object>(target: T) => {
  return new Proxy<T>(target, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver)
      // 实现自动脱 ref
      return value.__v_isRef ? value.value : value
    },
    set(target, key, newValue, receiver) {
      const value = target[key]

      // 设置自动脱 value
      if (value.__v_isRef) {
        value.value = newValue
        return true
      }

      return Reflect.set(target, key, newValue, receiver)
    },
  })
}
