import { createMemo, getOwner, runWithOwner } from 'solid-js'
import type { MatchFilter, MatchFilters, Params, PathMatch, RouteDescription, SetParams } from './types.ts'

const hasSchemeRegex = /^(?:[a-z0-9]+:)?\/\//i
const trimPathRegex = /^\/+|(\/)\/+$/g
export const mockBase = 'http://sr'

/**
 * 规范化路由路径，去除路径中的多余斜杠，或添加斜杠
 */
export function normalizePath(path: string, omitSlash: boolean = false) {
  const s = path.replace(trimPathRegex, '$1')
  return s ? (omitSlash || /^[?#]/.test(s) ? s : '/' + s) : ''
}

/**
 * 解析路径
 */
export function resolvePath(base: string, path: string, from?: string): string | undefined {
  if (hasSchemeRegex.test(path)) {
    return undefined
  }
  const basePath = normalizePath(base)
  const fromPath = from && normalizePath(from)
  let result = ''
  if (!fromPath || path.startsWith('/')) {
    result = basePath
  } else if (fromPath.toLowerCase().indexOf(basePath.toLowerCase()) !== 0) {
    result = basePath + fromPath
  } else {
    result = fromPath
  }
  return (result || '/') + normalizePath(path, !result)
}

export function invariant<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message)
  }
  return value
}

/**
 * 拼接路径
 */
export function joinPaths(from: string, to: string): string {
  return normalizePath(from).replace(/\/*(\*.*)?$/g, '') + normalizePath(to)
}

/**
 * 提取路径中的参数
 */
export function extractSearchParams(url: URL): Params {
  const params: Params = {}
  url.searchParams.forEach((value, key) => {
    params[key] = value
  })
  return params
}

export function createMatcher<S extends string>(path: S, partial?: boolean, matchFilters?: MatchFilters<S>) {
  // partial 表示是否允许部分匹配
  // splat 表示通配符
  const [pattern, splat] = path.split('/*', 2)
  const segments = pattern.split('/').filter(Boolean)
  const len = segments.length

  return (location: string): PathMatch | null => {
    const locSegments = location.split('/').filter(Boolean)
    const lenDiff = locSegments.length - len
    // 1. 路径长度不匹配
    // 2. 路径长度不匹配，没有通配符，且不允许部分匹配
    if (lenDiff < 0 || (lenDiff > 0 && splat === undefined && !partial)) {
      return null
    }

    const match: PathMatch = {
      path: len ? '' : '/',
      params: {},
    }

    const matchFilter = (s: string) =>
      matchFilters === undefined ? undefined : (matchFilters as Record<string, MatchFilter>)[s]

    // 遍历 segments 和 locSegments 进行匹配
    for (let i = 0; i < len; i++) {
      const segment = segments[i]
      const locSegment = locSegments[i]
      // 是否是动态路由（:id）
      const dynamic = segment[0] === ':'
      // 动态路由的 key
      const key = dynamic ? segment.slice(1) : segment

      if (dynamic && matchSegment(locSegment, matchFilter(key))) {
        // 动态路由匹配，提取参数
        match.params[key] = locSegment
      } else if (dynamic || !matchSegment(locSegment, segment)) {
        return null
      }
      match.path += `/${locSegment}`
    }
    // 到这里说明匹配成功了

    // 如果存在通配符，那么将剩余的路径都作为通配符的参数
    if (splat) {
      const remainder = lenDiff ? locSegments.slice(-lenDiff).join('/') : ''
      if (matchSegment(remainder, matchFilter(splat))) {
        match.params[splat] = remainder
      } else {
        return null
      }
    }

    // 返回匹配结果
    return match
  }
}

/**
 * 匹配路径
 */
function matchSegment(input: string, filter?: string | MatchFilter): boolean {
  const isEqual = (s: string) => s.localeCompare(input, undefined, { sensitivity: 'base' }) === 0

  if (filter === undefined) {
    return true
  } else if (typeof filter === 'string') {
    return isEqual(filter)
  } else if (typeof filter === 'function') {
    return (filter as Function)(input)
  } else if (Array.isArray(filter)) {
    return (filter as string[]).some(isEqual)
  } else if (filter instanceof RegExp) {
    return (filter as RegExp).test(input)
  }
  return false
}

export function scoreRoute(route: RouteDescription): number {
  const [pattern, splat] = route.pattern.split('/*', 2)
  const segments = pattern.split('/').filter(Boolean)
  return segments.reduce(
    // :id 这种动态路由的权重为 2，其他为 3
    (score, segment) => score + (segment.startsWith(':') ? 2 : 3),
    // 而通配符的权重为 1
    segments.length - (splat === undefined ? 0 : 1),
  )
}

/**
 * 创建一个响应式对象
 */
export function createMemoObject<T extends Record<string | symbol, unknown>>(fn: () => T): T {
  const map = new Map()
  const owner = getOwner()!
  return new Proxy(<T>{}, {
    get(_, property) {
      if (!map.has(property)) {
        runWithOwner(owner, () =>
          map.set(
            property,
            createMemo(() => fn()[property]),
          ),
        )
      }
      return map.get(property)()
    },
    getOwnPropertyDescriptor() {
      return {
        enumerable: true,
        configurable: true,
      }
    },
    ownKeys() {
      return Reflect.ownKeys(fn())
    },
  })
}

/**
 * 合并路径中的参数，转换成 query string
 */
export function mergeSearchString(search: string, params: SetParams) {
  const merged = new URLSearchParams(search)
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') {
      merged.delete(key)
    } else {
      merged.set(key, String(value))
    }
  })
  const s = merged.toString()
  return s ? `?${s}` : ''
}

/**
 * 根据路由路径，生成所有可能的路由路径
 */
export function expandOptionals(pattern: string): string[] {
  let match = /(\/?\:[^\/]+)\?/.exec(pattern)
  if (!match) return [pattern]

  let prefix = pattern.slice(0, match.index)
  let suffix = pattern.slice(match.index + match[0].length)
  const prefixes: string[] = [prefix, (prefix += match[1])]

  // This section handles adjacent optional params. We don't actually want all permuations since
  // that will lead to equivalent routes which have the same number of params. For example
  // `/:a?/:b?/:c`? only has the unique expansion: `/`, `/:a`, `/:a/:b`, `/:a/:b/:c` and we can
  // discard `/:b`, `/:c`, `/:b/:c` by building them up in order and not recursing. This also helps
  // ensure predictability where earlier params have precidence.
  while ((match = /^(\/\:[^\/]+)\?/.exec(suffix))) {
    prefixes.push((prefix += match[1]))
    suffix = suffix.slice(match[0].length)
  }

  return expandOptionals(suffix).reduce<string[]>(
    (results, expansion) => [...results, ...prefixes.map(p => p + expansion)],
    [],
  )
}
