import { effect } from './effect'
import { reactive } from './reactive'

const p = reactive(new Set([1, 2, 3]))

effect(() => {
  // console.log(p.size)
})

p.add(10)
