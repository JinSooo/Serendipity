/**
 * 惰性单例模式
 *  仅在调用该函数之后才开始执行，后续直接通过result拿结果
 * @param fn 需要保持单例的函数
 */
const getSingleton = (fn: (...params) => any) => {
  let result: any
  return (...params) => {
    return result ?? (result = fn.apply(this, params))
  }
}

const sum = (a: number, b: number) => a + b

const singleton = getSingleton(sum)

console.log('singleton', singleton(3, 4))
console.log('singleton', singleton(3, 4))
