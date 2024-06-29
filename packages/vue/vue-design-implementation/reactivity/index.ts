import { effect } from './effect'
import { reactive } from './reactive'

const p = reactive(new Map<string, string>([['a', '1']]))

// effect(() => {
//   p.forEach((v, k, i) => console.log('v, k', v, k))
// })

effect(() => {
  for (const [key, value] of p) {
    console.log('key, value', key, value)
  }
})

effect(() => {
  for (const value of p.values()) {
    console.log('value', value)
  }
})

effect(() => {
  for (const key of p.keys()) {
    console.log('key', key)
  }
})

p.set('a', '2')
