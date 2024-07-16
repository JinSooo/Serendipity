/**
 * 代理模式
 *  - 一种是通过一个对象代理另一个对象，对其做一些预处理，如按需加载，或者懒加载
 *  - 另一种是缓存代理，如 useMemo
 *  - ...
 */

// 缓存代理
const createProxyFactory = (fn: (...params) => any) => {
  const cache: Record<string, any> = {}

  return (...params) => {
    const args = params.join(',')
    if (args in cache) {
      return cache[args]
    }
    return (cache[args] = fn.apply(this, params))
  }
}

const plus = (...params) => {
  return params.reduce((sum, i) => sum + i, 0)
}
const proxyPlus = createProxyFactory(plus)

console.log(proxyPlus(1, 2, 3))
console.log(proxyPlus(1, 2, 3))
