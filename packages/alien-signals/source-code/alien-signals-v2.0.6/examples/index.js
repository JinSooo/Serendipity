import { computed, signal, effect, startBatch, endBatch } from "../esm/index.mjs";

/* ------- should correctly propagate changes through computed signals ------ */
// const src = signal(0);
// const c1 = computed(() => src() % 2);
// const c2 = computed(() => c1());
// const c3 = computed(() => c2());

// console.log(c3());
// src(1); // c1 -> dirty, c2 -> toCheckDirty, c3 -> toCheckDirty
// console.log(c2()); // c1 -> none, c2 -> none
// src(3); // c1 -> dirty, c2 -> toCheckDirty（c3 因为之前已经变为 dirty 这里不需要再做处理）

/* ------ should handle flags are indirectly updated during checkDirty ------ */
// const a = signal(false);
// const b = computed(() => a());
// const c = computed(() => {
//   b();
//   return 0;
// });
// const d = computed(() => {
//   c();
//   return b();
// });

// console.log(d());
// a(true);
// // 在 a 更新后，会给所有订阅着变为 pending 状态
// // 在读取 d 的值后，通过 checkDirty 会往上找回到 a，发现确实是 dirty 之后，更新 b 的值，
// // 而 b 存在 c 和 d 两个订阅者，这里就会通过 shallowPropagate 间接的给 c 和 d 变为 dirty 状态
// console.log(d());

/* ------------ should not update if the signal value is reverted ----------- */
let times = 0;

const src = signal(0);
const c1 = computed(() => {
  times++;
  return src();
});
c1();
src(1);
src(0);
c1();
// update 的时候才会更新 signal 的 previousValue，而在执行 src 的时候，只是 value 值发生了变化，previousValue 没有变化，所以不会更新
// 最终在更新 c1 的时候，判断 value 和 previousValue 是一样的，相对来说其实 previousValue 的值是跟着 computed/effect 一起懒加载的


function batchEffect(fn) {
  return effect(() => {
    startBatch();
    try {
      return fn();
    } finally {
      endBatch();
    }
  });
}

const logs= [];
const a = signal(0);
const b = signal(0);

const aa = computed(() => {
  logs.push('aa-0');
  if (!a()) {
    b(1);
  }
  logs.push('aa-1');
});

const bb = computed(() => {
  logs.push('bb');
  return b();
});

console.log("🚀 ~ logs:", logs)
batchEffect(() => {
  bb();
});
console.log("🚀 ~ logs2:", logs)
batchEffect(() => {
  aa();
});
console.log("🚀 ~ logs3:", logs)
