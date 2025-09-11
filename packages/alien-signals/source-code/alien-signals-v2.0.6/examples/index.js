import { computed, signal } from "../esm/index.mjs";

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
const a = signal(false);
const b = computed(() => a());
const c = computed(() => {
  b();
  return 0;
});
const d = computed(() => {
  c();
  return b();
});

console.log(d());
a(true);
// 在 a 更新后，会给所有订阅着变为 pending 状态
// 在读取 d 的值后，通过 checkDirty 会往上找回到 a，发现确实是 dirty 之后，更新 b 的值，
// 而 b 存在 c 和 d 两个订阅者，这里就会通过 shallowPropagate 间接的给 c 和 d 变为 dirty 状态
console.log(d());
