import { createReactiveSystem, ReactiveFlags } from "../esm/system.mjs";

const system = createReactiveSystem({
  update: (sub) => {
    if (sub === reactiveB) {
      // Computed B 重新计算
      const oldValue = sub.value;
      sub.value = reactiveA.value * 2; // 示例计算
      return oldValue !== sub.value;
    }
    return true;
  },
  notify: (sub) => {
    if (sub === reactiveC) {
      // Effect C 执行
      console.log("Effect triggered, A =", reactiveA.value, "B =", reactiveB.value);
    }
  },
  unwatched: (sub) => {
    console.log("unwatched", sub);
  },
});
console.log("🚀 ~ system:", system)

// 扩展的 ReactiveNode 定义
const reactiveA = {
  name: 'A',
  subs: undefined, subsTail: undefined, deps: undefined, depsTail: undefined,
  flags: ReactiveFlags.Mutable,
  value: 0, previousValue: 0
};

const reactiveB = {
  name: 'B',
  subs: undefined, subsTail: undefined, deps: undefined, depsTail: undefined,
  flags: ReactiveFlags.Mutable | ReactiveFlags.Dirty,
  value: 0
};

const reactiveC = {
  name: 'C',
  subs: undefined, subsTail: undefined, deps: undefined, depsTail: undefined,
  flags: ReactiveFlags.Watching
};

// 建立依赖关系
system.link(reactiveA, reactiveB);
system.link(reactiveB, reactiveC);

// 触发更新的函数
function updateA(newValue) {
  if (reactiveA.value !== newValue) {
    reactiveA.value = newValue;
    reactiveA.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;

    if (reactiveA.subs !== undefined) {
      system.propagate(reactiveA.subs);
    }
  }
}

// 使用
updateA(5); // 这会触发 B 的 update 和 C 的 notify
