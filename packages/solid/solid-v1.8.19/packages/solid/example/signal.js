import "../dist/dev.js";
import { createSignal, createEffect, createMemo } from "../dist/solid.js";

debugger;
const [track, trigger] = createSignal(0);

console.log(track());

createEffect(() => {
  console.log(track());
});
const memo = createMemo(() => track() * 2);

// effect 套 effect(memo)
createEffect(() => {
  console.log(memo());
});

setTimeout(() => {
  trigger(1);
}, 1000);

/*
执行结果是：0、0、0、2、1
前面 3 个没啥问题，但为什么 memo 的 effect 会比原本的先执行呢？
这里就要看它里面的逻辑了
trigger 之后，首先执行的是 memo，这是 memo 也需要更新了，那么就会找到 memo 的所有 observers，这其中就会引起 memo 的 effect 的执行
再深层次说一点，memo 属于 pure effect，会走 Updates，优先级比普通 effect 高，同时连锁反应引起 memo 的 effect 会比普通 effect 先插入到队列中
我的理解：Updates中的更新会影响 Signal，Signal 中的更新会影响 effect，所以先执行 Updates，再将所有的 effect 放在最后一起执行
*/
