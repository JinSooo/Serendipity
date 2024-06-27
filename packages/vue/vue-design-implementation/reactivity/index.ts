import { effect } from './effect'
import { reactive, readonly } from './reactive'

const data = { ok: true, text: 'hello', count: 0, foo: { test: true } }
const obj = readonly(data)

const data2 = [data]
const arr = reactive(data2)

// effect(() => {
//   for (const key in arr) {
//     console.log(key)
//   }
// })

effect(() => {
  // for...of 会读取数组的length和元素值，不需要做任何额外处理
  for (const val of arr) {
    console.log(val)
  }
})

effect(() => {
  arr.push(100)
})

console.log(arr.includes(data))
