import { createSignal, createEffect } from '../packages/solid/src/reactive/dist/signal.js'

const [signal1, trigger1] = createSignal(1)
const [signal2, trigger2] = createSignal('1')

// computation1
createEffect(() => {
  console.log('track1', signal1(), 'track2', signal2())
})

// computation2
createEffect(() => {
  console.log('track1', signal1() * 2)
})

setTimeout(() => {
  trigger1(10)
  trigger2('10')
}, 1000)
