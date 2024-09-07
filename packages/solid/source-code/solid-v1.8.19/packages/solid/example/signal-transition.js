import { createSignal, createEffect, useTransition } from "../dist/solid.js";

const [isPending, startTransition] = useTransition();
const [signal, setSignal] = createSignal("start");

createEffect(() => console.log("something", signal()));

// startTransition 内部通过 Promise.resolve() 去推迟执行，来实现的 Transition
startTransition(() => {
  console.log('1')
  setSignal("end")
})

console.log('-----------------')

console.log('2')
setSignal("final")

Promise.resolve().then(() => console.log('3'))

setTimeout(() => {
  console.log('4')
})

/**
执行结果：
（顺序执行）
2
（微任务）
1
3
（宏任务）
4
-----------------
没问题，先
1.顺序执行
2.执行微任务
3.执行宏任务
*/
