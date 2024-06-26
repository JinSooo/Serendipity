import { effect } from './effect'

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

export const watch = (source: any, cb: (newValue, oldValue, onInvalidate) => void, options: WatchOptions = {}) => {
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
