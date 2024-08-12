import { createSignal, createEffect } from '../packages/solid/src/reactive/dist/signal.js'

const [track, trigger] = createSignal(0)

console.log(track())

createEffect(() => {
  console.log(track())
})

setTimeout(() => {
  trigger(1)
}, 1000)
