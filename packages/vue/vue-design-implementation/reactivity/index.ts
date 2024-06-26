import { effect } from './effect'
import { reactive } from './reactive'

const data = { ok: true, text: 'hello', count: 0 }

const obj = reactive(data)

effect(() => {
  for (const key in obj) {
    console.log(key)
  }
})

obj.c = false
