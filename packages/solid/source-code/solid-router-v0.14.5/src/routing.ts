import { type JSX, type Accessor, runWithOwner, batch } from 'solid-js'
import {
  createComponent,
  createContext,
  createMemo,
  createRenderEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
  useContext,
  startTransition,
  resetErrorBoundaries,
} from 'solid-js'
import { isServer, getRequestEvent } from 'solid-js/web'
import { createBeforeLeave } from './lifecycle.js'
import type {
  BeforeLeaveEventArgs,
  Branch,
  Intent,
  Location,
  LocationChange,
  MatchFilters,
  MaybePreloadableComponent,
  NavigateOptions,
  Navigator,
  Params,
  RouteDescription,
  RouteContext,
  RouteDefinition,
  RouteMatch,
  RouterContext,
  RouterIntegration,
  SetParams,
  Submission,
} from './types.js'
import {
  mockBase,
  createMemoObject,
  extractSearchParams,
  invariant,
  resolvePath,
  createMatcher,
  joinPaths,
  scoreRoute,
  mergeSearchString,
  expandOptionals,
} from './utils.js'

const MAX_REDIRECTS = 100

export const RouterContextObj = createContext<RouterContext>()
export const RouteContextObj = createContext<RouteContext>()

/**
 * 获取 RouterContext 上下文
 */
export const useRouter = () =>
  invariant(useContext(RouterContextObj), "<A> and 'use' router primitives can be only used inside a Route.")

let TempRoute: RouteContext | undefined
/**
 * 获取 RouteContext 上下文
 */
export const useRoute = () => TempRoute || useContext(RouteContextObj) || useRouter().base

export const useResolvedPath = (path: () => string) => {
  const route = useRoute()
  return createMemo(() => route.resolvePath(path()))
}

export const useHref = (to: () => string | undefined) => {
  const router = useRouter()
  return createMemo(() => {
    const to_ = to()
    return to_ !== undefined ? router.renderPath(to_) : to_
  })
}

export const useNavigate = () => useRouter().navigatorFactory()
export const useLocation = <S = unknown>() => useRouter().location as Location<S>
export const useIsRouting = () => useRouter().isRouting
export const usePreloadRoute = () => useRouter().preloadRoute

export const useMatch = <S extends string>(path: () => S, matchFilters?: MatchFilters<S>) => {
  const location = useLocation()
  const matchers = createMemo(() => expandOptionals(path()).map(path => createMatcher(path, undefined, matchFilters)))
  return createMemo(() => {
    for (const matcher of matchers()) {
      const match = matcher(location.pathname)
      if (match) return match
    }
  })
}

export const useCurrentMatches = () => useRouter().matches

export const useParams = <T extends Params>() => useRouter().params as T

export const useSearchParams = <T extends Params>(): [
  Partial<T>,
  (params: SetParams, options?: Partial<NavigateOptions>) => void,
] => {
  const location = useLocation()
  const navigate = useNavigate()
  const setSearchParams = (params: SetParams, options?: Partial<NavigateOptions>) => {
    const searchString = untrack(() => mergeSearchString(location.search, params) + location.hash)
    navigate(searchString, {
      scroll: false,
      resolve: false,
      ...options,
    })
  }
  return [location.query as Partial<T>, setSearchParams]
}

export const useBeforeLeave = (listener: (e: BeforeLeaveEventArgs) => void) => {
  const s = useRouter().beforeLeave.subscribe({
    listener,
    location: useLocation(),
    navigate: useNavigate(),
  })
  onCleanup(s)
}

export function createRoutes(routeDef: RouteDefinition, base = ''): RouteDescription[] {
  const { component, preload, load, children, info } = routeDef
  const isLeaf = !children || (Array.isArray(children) && !children.length)

  const shared = {
    key: routeDef,
    component,
    preload: preload || load,
    info,
  }

  // routeDef.path 路径支持数组形式
  return asArray(routeDef.path).reduce<RouteDescription[]>((acc, originalPath) => {
    // expandOptionals 找到所有可能的路由路径
    for (const expandedPath of expandOptionals(originalPath)) {
      const path = joinPaths(base, expandedPath)
      // pattern 用于 matcher 做后续的路由匹配使用
      let pattern = isLeaf ? path : path.split('/*', 1)[0]
      pattern = pattern
        .split('/')
        .map((s: string) => {
          return s.startsWith(':') || s.startsWith('*') ? s : encodeURIComponent(s)
        })
        .join('/')
      acc.push({
        ...shared,
        originalPath,
        pattern,
        matcher: createMatcher(pattern, !isLeaf, routeDef.matchFilters),
      })
    }
    return acc
  }, [])
}

export function createBranch(routes: RouteDescription[], index = 0): Branch {
  return {
    routes,
    // score 用于计算权重
    score: scoreRoute(routes[routes.length - 1]) * 10000 - index,
    matcher(location) {
      const matches: RouteMatch[] = []
      for (let i = routes.length - 1; i >= 0; i--) {
        const route = routes[i]
        const match = route.matcher(location)
        if (!match) {
          return null
        }
        matches.unshift({
          ...match,
          route,
        })
      }
      return matches
    },
  }
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}

export function createBranches(
  routeDef: RouteDefinition | RouteDefinition[],
  base = '',
  stack: RouteDescription[] = [],
  branches: Branch[] = [],
): Branch[] {
  const routeDefs = asArray(routeDef)

  for (let i = 0, len = routeDefs.length; i < len; i++) {
    const def = routeDefs[i]
    if (def && typeof def === 'object') {
      if (!def.hasOwnProperty('path')) def.path = ''
      const routes = createRoutes(def, base)
      for (const route of routes) {
        // stack 用于存储当前的路由信息，并通过递归的方式，将当前的路由信息存储在 stack 中
        stack.push(route)
        const isEmptyArray = Array.isArray(def.children) && def.children.length === 0
        if (def.children && !isEmptyArray) {
          createBranches(def.children, route.pattern, stack, branches)
        } else {
          // 无 children 的则创建一个分支，然后直接添加到 branches 中
          // 反之，则递归调用 createBranches 函数，继续创建分支，直到叶子节点，再添加到 branches 中
          const branch = createBranch([...stack], branches.length)
          branches.push(branch)
        }

        // 一条分支处理完成后，将当前的路由信息从 stack 中弹出
        stack.pop()
      }
    }
  }

  // Stack will be empty on final return
  return stack.length ? branches : branches.sort((a, b) => b.score - a.score)
}

export function getRouteMatches(branches: Branch[], location: string): RouteMatch[] {
  for (let i = 0, len = branches.length; i < len; i++) {
    // 调用 Branch 里封装的 matcher 方法去匹配判断是否是对应路由
    const match = branches[i].matcher(location)
    if (match) {
      return match
    }
  }
  return []
}

export function createLocation(path: Accessor<string>, state: Accessor<any>): Location {
  const origin = new URL(mockBase)
  const url = createMemo<URL>(
    prev => {
      const path_ = path()
      try {
        return new URL(path_, origin)
      } catch (err) {
        console.error(`Invalid path ${path_}`)
        return prev
      }
    },
    origin,
    {
      equals: (a, b) => a.href === b.href,
    },
  )

  const pathname = createMemo(() => url().pathname)
  const search = createMemo(() => url().search, true)
  const hash = createMemo(() => url().hash)
  const key = () => ''

  return {
    get pathname() {
      return pathname()
    },
    get search() {
      return search()
    },
    get hash() {
      return hash()
    },
    get state() {
      return state()
    },
    get key() {
      return key()
    },
    query: createMemoObject(on(search, () => extractSearchParams(url())) as () => Params),
  }
}

let intent: Intent | undefined
export function getIntent() {
  return intent
}
let inPreloadFn = false
export function getInPreloadFn() {
  return inPreloadFn
}
export function setInPreloadFn(value: boolean) {
  inPreloadFn = value
}

export function createRouterContext(
  integration: RouterIntegration,
  branches: () => Branch[],
  getContext?: () => any,
  options: { base?: string; singleFlight?: boolean; transformUrl?: (url: string) => string } = {},
): RouterContext {
  // 这里的 signal 来自最外层的 createRouter 上
  // 而最终的值会归宿到 createRouter 的参数的 get、set 两个方法上
  // 里面利用的 intercept 对 createSignal 进行拦截处理
  const {
    signal: [source, setSource],
    utils = {},
  } = integration

  const parsePath = utils.parsePath || (p => p)
  const renderPath = utils.renderPath || (p => p)
  const beforeLeave = utils.beforeLeave || createBeforeLeave()

  const basePath = resolvePath('', options.base || '')
  if (basePath === undefined) {
    throw new Error(`${basePath} is not a valid base path`)
  } else if (basePath && !source().value) {
    setSource({ value: basePath, replace: true, scroll: false })
  }

  // 路由跳转过程ing
  const [isRouting, setIsRouting] = createSignal(false)

  // Keep track of last target, so that last call to transition wins
  let lastTransitionTarget: LocationChange | undefined

  // Transition the location to a new value
  const transition = (newIntent: Intent, newTarget: LocationChange) => {
    if (newTarget.value === reference() && newTarget.state === state()) return

    if (lastTransitionTarget === undefined) setIsRouting(true)

    intent = newIntent
    lastTransitionTarget = newTarget

    startTransition(() => {
      if (lastTransitionTarget !== newTarget) return

      setReference(lastTransitionTarget.value)
      setState(lastTransitionTarget.state)
      resetErrorBoundaries()
      if (!isServer) submissions[1]([])
    }).finally(() => {
      if (lastTransitionTarget !== newTarget) return

      // Batch, in order for isRouting and final source update to happen together
      batch(() => {
        intent = undefined
        if (newIntent === 'navigate') navigateEnd(lastTransitionTarget!)

        setIsRouting(false)
        lastTransitionTarget = undefined
      })
    })
  }
  // url + window.location.hash
  const [reference, setReference] = createSignal(source().value)
  // window.history.state
  const [state, setState] = createSignal(source().state)
  // 封装 location.href，进行响应式处理
  const location = createLocation(reference, state)
  // 存储 navigate 跳转前的路由信息
  const referrers: LocationChange[] = []
  // 存储所有已注册的 Action 的状态信息
  const submissions = createSignal<Submission<any, any>[]>(isServer ? initFromFlash() : [])

  // 当前匹配的路由信息
  const matches = createMemo(() => {
    if (typeof options.transformUrl === 'function') {
      return getRouteMatches(branches(), options.transformUrl(location.pathname))
    }

    return getRouteMatches(branches(), location.pathname)
  })

  // 匹配路由信息的参数
  const params = createMemoObject(() => {
    const m = matches()
    const params: Params = {}
    for (let i = 0; i < m.length; i++) {
      Object.assign(params, m[i].params)
    }
    return params
  })

  // 基础路由信息
  const baseRoute: RouteContext = {
    pattern: basePath,
    path: () => basePath,
    outlet: () => null,
    resolvePath(to: string) {
      return resolvePath(basePath, to)
    },
  }

  // Create a native transition, when source updates
  // 监听当 source（location url）出现变化的时候，进行路由跳转
  createRenderEffect(on(source, source => transition('native', source), { defer: true }))

  return {
    base: baseRoute,
    location,
    params,
    isRouting,
    renderPath,
    parsePath,
    navigatorFactory,
    matches,
    beforeLeave,
    preloadRoute,
    singleFlight: options.singleFlight === undefined ? true : options.singleFlight,
    submissions,
  }

  // 路由跳转
  function navigateFromRoute(route: RouteContext, to: string | number, options?: Partial<NavigateOptions>) {
    // Untrack in case someone navigates in an effect - don't want to track `reference` or route paths
    untrack(() => {
      if (typeof to === 'number') {
        if (!to) {
          // A delta of 0 means stay at the current location, so it is ignored
        } else if (utils.go) {
          // utils.go 是最上层 Router 里实现的
          utils.go(to)
        } else {
          console.warn('Router integration does not support relative routing')
        }
        return
      }

      const queryOnly = !to || to[0] === '?'
      const {
        replace,
        resolve,
        scroll,
        state: nextState,
      } = {
        replace: false,
        resolve: !queryOnly,
        scroll: true,
        ...options,
      }

      let s: string
      const resolvedTo = resolve ? route.resolvePath(to) : resolvePath((queryOnly && location.pathname) || '', to)

      if (resolvedTo === undefined) {
        throw new Error(`Path '${to}' is not a routable path`)
      } else if (referrers.length >= MAX_REDIRECTS) {
        throw new Error('Too many redirects')
      }

      const current = reference()

      if (resolvedTo !== current || nextState !== state()) {
        if (isServer) {
          const e = getRequestEvent()
          e && (e.response = { status: 302, headers: new Headers({ Location: resolvedTo }) })
          setSource({ value: resolvedTo, replace, scroll, state: nextState })
        } else if (beforeLeave.confirm(resolvedTo, options)) {
          // 路由跳转前，将当前的路由信息存储在 referrers 中
          referrers.push({ value: current, replace, scroll, state: state() })
          // 进行路由跳转
          transition('navigate', {
            value: resolvedTo,
            state: nextState,
          })
        }
      }
    })
  }

  // 封装 navigator 方法
  function navigatorFactory(route?: RouteContext): Navigator {
    // Workaround for vite issue (https://github.com/vitejs/vite/issues/3803)
    route = route || useContext(RouteContextObj) || baseRoute
    return (to: string | number, options?: Partial<NavigateOptions>) => navigateFromRoute(route!, to, options)
  }

  // 路由跳转结束，更新 source 信息
  function navigateEnd(next: LocationChange) {
    const first = referrers[0]
    if (first) {
      setSource({
        ...next,
        replace: first.replace,
        scroll: first.scroll,
      })
      referrers.length = 0
    }
  }

  /**
   * 预加载路由
   */
  function preloadRoute(url: URL, options: { preloadData?: boolean } = {}) {
    const matches = getRouteMatches(branches(), url.pathname)
    const prevIntent = intent
    intent = 'preload'
    for (const match in matches) {
      const { route, params } = matches[match]
      route.component &&
        (route.component as MaybePreloadableComponent).preload &&
        (route.component as MaybePreloadableComponent).preload!()
      const { preload } = route
      inPreloadFn = true
      options.preloadData &&
        preload &&
        runWithOwner(getContext!(), () =>
          preload({
            params,
            location: {
              pathname: url.pathname,
              search: url.search,
              hash: url.hash,
              query: extractSearchParams(url),
              state: null,
              key: '',
            },
            intent: 'preload',
          }),
        )
      inPreloadFn = false
    }
    intent = prevIntent
  }

  function initFromFlash() {
    const e = getRequestEvent()
    return (e && e.router && e.router.submission ? [e.router.submission] : []) as Array<Submission<any, any>>
  }
}

/**
 * 创建 RouteContext
 */
export function createRouteContext(
  router: RouterContext,
  parent: RouteContext,
  outlet: () => JSX.Element,
  match: () => RouteMatch,
): RouteContext {
  const { base, location, params } = router
  const { pattern, component, preload } = match().route
  const path = createMemo(() => match().path)

  component && (component as MaybePreloadableComponent).preload && (component as MaybePreloadableComponent).preload!()
  inPreloadFn = true
  const data = preload ? preload({ params, location, intent: intent || 'initial' }) : undefined
  inPreloadFn = false

  // 返回一个封装好的 RouteContext
  const route: RouteContext = {
    parent,
    pattern,
    path,
    outlet: () =>
      component
        ? createComponent(component, {
            params,
            location,
            data,
            get children() {
              return outlet()
            },
          })
        : outlet(),
    resolvePath(to: string) {
      return resolvePath(base.path(), to, path())
    },
  }

  return route
}
