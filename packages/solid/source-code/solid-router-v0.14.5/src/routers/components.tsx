/*@refresh skip*/

import type { Component, JSX, Owner } from 'solid-js'
import { type RequestEvent, getRequestEvent, isServer } from 'solid-js/web'
import { children, createMemo, createRoot, getOwner, mergeProps, on, Show, untrack } from 'solid-js'
import {
  createBranches,
  createRouteContext,
  createRouterContext,
  getIntent,
  getRouteMatches,
  RouteContextObj,
  RouterContextObj,
  setInPreloadFn,
} from '../routing.js'
import type {
  MatchFilters,
  RouteContext,
  RouteDefinition,
  RouterIntegration,
  RouterContext,
  Branch,
  RouteSectionProps,
  RoutePreloadFunc,
} from '../types.js'

export type BaseRouterProps = {
  base?: string
  /**
   * A component that wraps the content of every route.
   */
  root?: Component<RouteSectionProps>
  rootPreload?: RoutePreloadFunc
  singleFlight?: boolean
  children?: JSX.Element | RouteDefinition | RouteDefinition[]
  transformUrl?: (url: string) => string
  /** @deprecated use rootPreload */
  rootLoad?: RoutePreloadFunc
}

export const createRouterComponent = (router: RouterIntegration) => (props: BaseRouterProps) => {
  const { base } = props
  /**
   * 获取路由定义，有两种形式
   * 1. 直接传入 RouteDefinition 或 RouteDefinition[]
   * 2. 传入 Route 组件，通过 children 获取
   */
  const routeDefs = children(() => props.children as JSX.Element) as unknown as () =>
    | RouteDefinition
    | RouteDefinition[]

  // 根据路由信息生成路由分支
  const branches = createMemo(() => createBranches(routeDefs(), props.base || ''))
  let context: Owner
  // 包含一系列路由相关的状态信息
  const routerState = createRouterContext(router, branches, () => context, {
    base,
    singleFlight: props.singleFlight,
    transformUrl: props.transformUrl,
  })
  router.create && router.create(routerState)
  return (
    <RouterContextObj.Provider value={routerState}>
      <Root routerState={routerState} root={props.root} preload={props.rootPreload || props.rootLoad}>
        {(context = getOwner()!) && null}
        <Routes routerState={routerState} branches={branches()} />
      </Root>
    </RouterContextObj.Provider>
  )
}

/**
 * 可以在所有路由组件外面套一层，用于处理一些公共逻辑
 */
function Root(props: {
  routerState: RouterContext
  root?: Component<RouteSectionProps>
  preload?: RoutePreloadFunc
  children: JSX.Element
}) {
  const location = props.routerState.location
  const params = props.routerState.params
  const data = createMemo(
    () =>
      props.preload &&
      untrack(() => {
        setInPreloadFn(true)
        props.preload!({ params, location, intent: getIntent() || 'initial' })
        setInPreloadFn(false)
      }),
  )
  return (
    <Show when={props.root} keyed fallback={props.children}>
      {Root => (
        <Root params={params} location={location} data={data()}>
          {props.children}
        </Root>
      )}
    </Show>
  )
}

function Routes(props: { routerState: RouterContext; branches: Branch[] }) {
  if (isServer) {
    const e = getRequestEvent()
    if (e && e.router && e.router.dataOnly) {
      dataOnly(e, props.routerState, props.branches)
      return
    }
    e &&
      ((e.router || (e.router = {})).matches ||
        (e.router.matches = props.routerState.matches().map(({ route, path, params }) => ({
          path: route.originalPath,
          pattern: route.pattern,
          match: path,
          params,
          info: route.info,
        }))))
  }

  const disposers: (() => void)[] = []
  let root: RouteContext | undefined

  const routeStates = createMemo(
    // 监听当前匹配到的路由 matches
    on(props.routerState.matches, (nextMatches, prevMatches, prev: RouteContext[] | undefined) => {
      let equal = prevMatches && nextMatches.length === prevMatches.length
      const next: RouteContext[] = []
      for (let i = 0, len = nextMatches.length; i < len; i++) {
        const prevMatch = prevMatches && prevMatches[i]
        const nextMatch = nextMatches[i]

        if (prev && prevMatch && nextMatch.route.key === prevMatch.route.key) {
          // 复用
          next[i] = prev[i]
        } else {
          equal = false
          if (disposers[i]) {
            disposers[i]()
          }

          // 每一个路由都是一个 Root
          createRoot(dispose => {
            disposers[i] = dispose
            next[i] = createRouteContext(
              props.routerState,
              next[i - 1] || props.routerState.base,
              // 路由嵌套
              createOutlet(() => routeStates()[i + 1]),
              () => props.routerState.matches()[i],
            )
          })
        }
      }

      disposers.splice(nextMatches.length).forEach(dispose => dispose())

      if (prev && equal) {
        return prev
      }
      root = next[0]
      return next
    }),
  )
  return createOutlet(() => routeStates() && root)()
}

/**
 * 利用 createOutlet 创建一个动态的路由组件
 * 当匹配到的路由发生变化时，会重新渲染
 */
const createOutlet = (child: () => RouteContext | undefined) => {
  return () => (
    <Show when={child()} keyed>
      {child => <RouteContextObj.Provider value={child}>{child.outlet()}</RouteContextObj.Provider>}
    </Show>
  )
}

export type RouteProps<S extends string, T = unknown> = {
  path?: S | S[]
  children?: JSX.Element
  preload?: RoutePreloadFunc<T>
  matchFilters?: MatchFilters<S>
  component?: Component<RouteSectionProps<T>>
  info?: Record<string, any>
  /** @deprecated use preload */
  load?: RoutePreloadFunc<T>
}

/**
 * 单个路由组件，返回一个路由配置对象
 */
export const Route = <S extends string, T = unknown>(props: RouteProps<S, T>) => {
  const childRoutes = children(() => props.children)
  return mergeProps(props, {
    get children() {
      return childRoutes()
    },
  }) as unknown as JSX.Element
}

// for data only mode with single flight mutations
function dataOnly(event: RequestEvent, routerState: RouterContext, branches: Branch[]) {
  const url = new URL(event.request.url)
  const prevMatches = getRouteMatches(branches, new URL(event.router!.previousUrl || event.request.url).pathname)
  const matches = getRouteMatches(branches, url.pathname)
  for (let match = 0; match < matches.length; match++) {
    if (!prevMatches[match] || matches[match].route !== prevMatches[match].route) event.router!.dataOnly = true
    const { route, params } = matches[match]
    route.preload &&
      route.preload({
        params,
        location: routerState.location,
        intent: 'preload',
      })
  }
}
