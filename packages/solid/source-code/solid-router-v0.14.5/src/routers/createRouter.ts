import { type Signal, createSignal, onCleanup, sharedConfig } from 'solid-js'
import type { LocationChange, RouterContext, RouterUtils } from '../types.ts'
import { createRouterComponent } from './components.jsx'

/**
 * intercept 函数的作用是拦截 signal 的变化，自定义 get 和 set 函数
 */
function intercept<T>(
  [value, setValue]: [() => T, (v: T) => void],
  get?: (v: T) => T,
  set?: (v: T) => T,
): [() => T, (v: T) => void] {
  return [get ? () => get(value()) : value, set ? (v: T) => setValue(set(v)) : setValue]
}

function querySelector<T extends Element>(selector: string) {
  if (selector === '#') {
    return null
  }
  // Guard against selector being an invalid CSS selector
  try {
    return document.querySelector<T>(selector)
  } catch (e) {
    return null
  }
}

/**
 * 创建一个 router，提供一个 config 函数，暴露可配置的 get、set 等方法供外层使用
 * 说的就是 Router、HashRouter
 */
export function createRouter(config: {
  get: () => string | LocationChange
  set: (next: LocationChange) => void
  init?: (notify: (value?: string | LocationChange) => void) => () => void
  create?: (router: RouterContext) => void
  utils?: Partial<RouterUtils>
}) {
  let ignore = false
  const wrap = (value: string | LocationChange) => (typeof value === 'string' ? { value } : value)
  // 利用 Signal 去监听 config.get() location 的变化
  // 这里的 Signal 主要是去代理 get、set 两个函数，再在 createRouterContext 里面做处理
  const signal = intercept<LocationChange>(
    createSignal(wrap(config.get()), {
      equals: (a, b) => a.value === b.value && a.state === b.state,
    }),
    undefined,
    next => {
      // ignore 用于这里，避免设置出现死循环
      !ignore && config.set(next)
      if (sharedConfig.registry && !sharedConfig.done) sharedConfig.done = true
      return next
    },
  ) as Signal<LocationChange>

  // config.init 是监听 popstate 事件，当发生 popstate 事件时，执行 notify 函数
  config.init &&
    // config.init 会立即调用，同时 config.init 会返回一个清理函数给 onCleanup
    onCleanup(
      config.init((value = config.get()) => {
        // 设置 ignore 为 true，避免设置出现死循环
        ignore = true
        signal[1](wrap(value))
        ignore = false
      }),
    )

  return createRouterComponent({
    signal,
    create: config.create,
    utils: config.utils,
  })
}

export function bindEvent(target: EventTarget, type: string, handler: EventListener) {
  target.addEventListener(type, handler)
  return () => target.removeEventListener(type, handler)
}

export function scrollToHash(hash: string, fallbackTop?: boolean) {
  const el = querySelector(`#${hash}`)
  if (el) {
    el.scrollIntoView()
  } else if (fallbackTop) {
    window.scrollTo(0, 0)
  }
}
