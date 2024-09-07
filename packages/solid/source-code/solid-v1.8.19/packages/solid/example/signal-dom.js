import { createSignal, createEffect, createMemo } from "../dist/solid.js";

const signal1Elem = document.getElementById('signal1')
const signal2Elem = document.getElementById('signal2')
const memo1Elem = document.getElementById('memo1')
const triggerElem = document.getElementById('trigger')

const [signal1, trigger1] = createSignal(1)
const [signal2, trigger2] = createSignal('1')
const memo1 = createMemo(() => signal1() * 2)

// computation1
createEffect(() => {
  console.log('track1', signal1() + '_' + signal2())

  signal1Elem.textContent = signal1() + '_' + signal2()
})

// computation2
createEffect(() => {
  console.log('track2', signal2())

  signal2Elem.textContent = signal2()
})

// computation3
createEffect(() => {
  console.log('track2', memo1())

  memo1Elem.textContent = memo1()
})

triggerElem.addEventListener('click', () => {
  trigger1(Math.random() * 100)
  trigger2(`${Math.random() * 100}`)
})
