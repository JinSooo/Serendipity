import { isServer } from 'solid-js/web'
import { createRouter, scrollToHash, bindEvent } from './createRouter.js'
import { StaticRouter } from './StaticRouter.js'
import { setupNativeEvents } from '../data/events.js'
import type { BaseRouterProps } from './components.jsx'
import type { JSX } from 'solid-js'
import { createBeforeLeave, keepDepth, notifyIfNotBlocked, saveCurrentDepth } from '../lifecycle.js'

export type RouterProps = BaseRouterProps & {
  url?: string
  actionBase?: string
  explicitLinks?: boolean
  preload?: boolean
}

/**
 * Router 组件最终调用的是 createRouter 函数
 */
export function Router(props: RouterProps): JSX.Element {
  if (isServer) return StaticRouter(props)
  // 通过 location 和 history 获取当前路由信息
  const getSource = () => {
    const url = window.location.pathname.replace(/^\/+/, '/') + window.location.search
    const state =
      window.history.state && window.history.state._depth && Object.keys(window.history.state).length === 1
        ? undefined
        : window.history.state
    return {
      value: url + window.location.hash,
      state,
    }
  }
  // 在离开当前路由前执行一些操作
  const beforeLeave = createBeforeLeave()
  return createRouter({
    get: getSource,
    // 通过 replace 和 state 去更新 history
    set({ value, replace, scroll, state }) {
      if (replace) {
        window.history.replaceState(keepDepth(state), '', value)
      } else {
        window.history.pushState(state, '', value)
      }
      scrollToHash(decodeURIComponent(window.location.hash.slice(1)), scroll)
      saveCurrentDepth()
    },
    // 监听 popstate 事件，当发生 popstate 事件时，执行 notify 函数
    init: notify =>
      bindEvent(
        window,
        'popstate',
        notifyIfNotBlocked(notify, delta => {
          if (delta && delta < 0) {
            return !beforeLeave.confirm(delta)
          } else {
            const s = getSource()
            return !beforeLeave.confirm(s.value, { state: s.state })
          }
        }),
      ),
    create: setupNativeEvents(props.preload, props.explicitLinks, props.actionBase, props.transformUrl),
    utils: {
      go: delta => window.history.go(delta),
      beforeLeave,
    },
  })(props)
}
