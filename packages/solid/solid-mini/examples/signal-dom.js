import { createSignal, createEffect, createMemo } from '../packages/solid/src/reactive/dist/signal.js'

const signal1Elem = document.getElementById('signal1')
const signal2Elem = document.getElementById('signal2')
const memo1Elem = document.getElementById('memo1')
const triggerElem = document.getElementById('trigger')

const [signal1, trigger1] = createSignal(1)
const [signal2, trigger2] = createSignal('1')
const memo1 = createMemo(() => {
  console.log('memo1', signal1() * 2)

  memo1Elem.textContent = signal1() * 2

  return signal1() * 2
})

// computation1
createEffect(() => {
  console.log('track1', signal1())

  signal1Elem.textContent = signal1()
})

// computation2
createEffect(() => {
  console.log('track2', signal2())

  signal2Elem.textContent = signal2()
})

triggerElem.addEventListener('click', () => {
  trigger1(Math.random() * 100)
  trigger2(`${Math.random() * 100}`)
})
