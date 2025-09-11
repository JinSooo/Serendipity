export * from './system.js';

import { createReactiveSystem, type ReactiveNode, type ReactiveFlags } from './system.js';

const enum EffectFlags {
  /** 防止重复入队同一个 effect */
	Queued = 1 << 6,
}

interface EffectScope extends ReactiveNode { }

interface Effect extends ReactiveNode {
  /** 副作用函数 */
	fn(): void;
}

interface Computed<T = any> extends ReactiveNode {
  /** 只读计算值 */
	value: T | undefined;
  /** 计算新值的计算函数 */
	getter: (previousValue?: T) => T;
}

interface Signal<T = any> extends ReactiveNode {
  /** 前一个值 */
	previousValue: T;
  /** 可变信号值 */
	value: T;
}

const pauseStack: (ReactiveNode | undefined)[] = [];
// pending effect 队列
const queuedEffects: (Effect | EffectScope | undefined)[] = [];
const {
	link,
	unlink,
	propagate,
	checkDirty,
	endTracking,
	startTracking,
	shallowPropagate,
} = createReactiveSystem({
	update(signal: Signal | Computed): boolean {
    // 这里会根据 signal 是 Signal 还是 Computed 来调用不同的更新函数
		if ('getter' in signal) {
      // 1. 进行依赖收集，并计算新值
      // 2. 新旧值对比，返回是否需要更新
      // 3. 如果需要更新，则通知订阅者（依赖该信号的节点）
			return updateComputed(signal);
		} else {
      // 1. 更新 signal 的值
      // 2. 新旧值对比，返回是否需要更新
      // 3. 如果需要更新，则通知订阅者（依赖该信号的节点）
			return updateSignal(signal, signal.value);
		}
	},
	notify,
	unwatched(node: Signal | Computed | Effect | EffectScope) {
    // 处理 computed 节点
		if ('getter' in node) {
      // unlink 所有依赖
			let toRemove = node.deps;
			if (toRemove !== undefined) {
				node.flags = 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty;
				do {
					toRemove = unlink(toRemove, node);
				} while (toRemove !== undefined);
			}
		}
    // 处理 effect 节点
    else if (!('previousValue' in node)) {
      // 类似 cleanup 的生命周期
			effectOper.call(node);
		}
	},
});

// 批量更新深度
export let batchDepth = 0;

// pending effect 队列的索引
let notifyIndex = 0;
// pending effect 队列的长度
let queuedEffectsLength = 0;
// 当前的 activeSub（effect）
let activeSub: ReactiveNode | undefined;
// 当前的 activeScope（effectScope）
let activeScope: EffectScope | undefined;

export function getCurrentSub(): ReactiveNode | undefined {
	return activeSub;
}

export function setCurrentSub(sub: ReactiveNode | undefined) {
	const prevSub = activeSub;
	activeSub = sub;
	return prevSub;
}

export function getCurrentScope(): EffectScope | undefined {
	return activeScope;
}

export function setCurrentScope(scope: EffectScope | undefined) {
	const prevScope = activeScope;
	activeScope = scope;
	return prevScope;
}

/**
 * 开始批量更新
 */
export function startBatch() {
	++batchDepth;
}

/**
 * 结束批量更新
 * 如果 batchDepth 为 0，则执行 flush 进行批量更新，否则等待更多的 endBatch
 */
export function endBatch() {
	if (!--batchDepth) {
		flush();
	}
}

/**
 * @deprecated Will be removed in the next major version. Use `const pausedSub = setCurrentSub(undefined)` instead for better performance.
 */
export function pauseTracking() {
	pauseStack.push(setCurrentSub(undefined));
}

/**
 * @deprecated Will be removed in the next major version. Use `setCurrentSub(pausedSub)` instead for better performance.
 */
export function resumeTracking() {
	setCurrentSub(pauseStack.pop());
}

export function signal<T>(): {
	(): T | undefined;
	(value: T | undefined): void;
};
export function signal<T>(initialValue: T): {
	(): T;
	(value: T): void;
};
export function signal<T>(initialValue?: T): {
	(): T | undefined;
	(value: T | undefined): void;
} {
	return signalOper.bind({
		previousValue: initialValue,
		value: initialValue,
    // Signal 对应的订阅链表：指向该信号的订阅者（依赖该信号的节点）
		subs: undefined,
		subsTail: undefined,
    // Signal 对应的标志位：Mutable 表示可变信号
		flags: 1 satisfies ReactiveFlags.Mutable,
	}) as () => T | undefined;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
	return computedOper.bind({
		value: undefined,
    // computed 结合 signal 和 effect，包含 signal 的订阅链表，以及 effect 的依赖链表
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
    // computed 对应的标志位：Mutable 表示可变计算值，Dirty 表示脏数据（需要重新计算）
    // 惰性加载，只有用到的时候才会重新计算，这里标识脏数据会进行重新计算
		flags: 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty,
		getter: getter as (previousValue?: unknown) => unknown,
	}) as () => T;
}

/**
 * effect 函数，用于创建副作用
 *  1. 在创建时会执行一次
 *  2. 在依赖变化时会重新执行（signal changed -> propagate -> notify -> flush -> run -> re-execute）
 */
export function effect(fn: () => void): () => void {
	const e: Effect = {
		fn,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
    // effect 对应的标志位：Watching 表示正在被监听
		flags: 2 satisfies ReactiveFlags.Watching,
	};
  // 处理嵌套 effect 的情况
	if (activeSub !== undefined) {
		link(e, activeSub);
	}
  // 将 effect 关联到对应的 scope
  else if (activeScope !== undefined) {
		link(e, activeScope);
	}
  // 这里的处理和 computed 类似，都是设置 currentSub 为 effect，然后执行 effect 的 fn 函数
	const prev = setCurrentSub(e);
	try {
		e.fn();
	} finally {
		setCurrentSub(prev);
	}
	return effectOper.bind(e);
}

/**
 * effectScope 函数，用于创建副作用作用域
 * 将 scope 内部的所有 effect 作为一个单元，当执行清理函数时，会清理内部的所有 effect
 */
export function effectScope(fn: () => void): () => void {
	const e: EffectScope = {
		deps: undefined,
		depsTail: undefined,
		subs: undefined,
		subsTail: undefined,
		flags: 0 satisfies ReactiveFlags.None,
	};
  // 处理嵌套 effectScope 的情况
	if (activeScope !== undefined) {
		link(e, activeScope);
	}
	const prevSub = setCurrentSub(undefined);
	const prevScope = setCurrentScope(e);
	try {
		fn();
	} finally {
		setCurrentScope(prevScope);
		setCurrentSub(prevSub);
	}
	return effectOper.bind(e);
}

function updateComputed(c: Computed): boolean {
  // 更新计算值前，先设置当前的 activeSub 为 c（这里的 computed 实际也是一个 effect）
	const prevSub = setCurrentSub(c);
  // 开始跟踪依赖
	startTracking(c);
	try {
		const oldValue = c.value;
    /**
     * getter 里面做具体的依赖收集，上面设置了当前的 currentSub，
     * 当 getter 里面获取了某个 signal 的值，则会将该 signal 添加到当前的 currentSub 的订阅链表中（currentSub 实际指的就是 effect）
     * 然后计算出最新的值，并赋值给 c.value，最后清除当前 sub，并结束跟踪依赖，清除依赖关系。
     */
		return oldValue !== (c.value = c.getter(oldValue));
	} finally {
    // 使用完当前 computed(effect)，重置当前的 activeSub
		setCurrentSub(prevSub);
		endTracking(c);
	}
}

function updateSignal(s: Signal, value: any): boolean {
  // Signal 值更新完成后，重置标志位
	s.flags = 1 satisfies ReactiveFlags.Mutable;
  /**
   * 1. 左侧 s.previousValue 先赋予旧值
   * 2. 右侧 s.previousValue 赋予新值
   * 3. 返回新旧值是否相等
   */
	return s.previousValue !== (s.previousValue = value);
}

function notify(e: Effect | EffectScope) {
	const flags = e.flags;
  // 加入到队列中，统一处理更新（如果已经入队，则不重复入队）
	if (!(flags & EffectFlags.Queued)) {
		e.flags = flags | EffectFlags.Queued;
    // 如果 effect 有订阅者，则通知订阅者（依赖该 effect 的节点）
		const subs = e.subs;
    // 有 subs，说明是 signal、computed
		if (subs !== undefined) {
      // 通知订阅者（依赖该 effect 的节点）
			notify(subs.sub as Effect | EffectScope);
		}
    // 没有 subs，说明是 effect
    else {
      // 如果 effect 没有订阅者，则加入到队列中，统一处理更新
			queuedEffects[queuedEffectsLength++] = e;
		}
	}
}

/**
 * 执行 effect
 */
function run(e: Effect | EffectScope, flags: ReactiveFlags): void {
  // 如果标志位为脏数据，则更新值，并通知订阅者（依赖该信号的节点）
	if (
		flags & 16 satisfies ReactiveFlags.Dirty
		||
    // 如果处于 PENDING，并且是脏数据，也就说明，当前的 effect 依赖的节点是脏数据，需要更新
    (flags & 32 satisfies ReactiveFlags.Pending && checkDirty(e.deps!, e))
	) {
    // 设置当前的 activeSub 为 effect，来进行依赖收集
		const prev = setCurrentSub(e);
		startTracking(e);
		try {
			(e as Effect).fn();
		} finally {
			setCurrentSub(prev);
			endTracking(e);
		}
		return;
	} else if (flags & 32 satisfies ReactiveFlags.Pending) {
		e.flags = flags & ~(32 satisfies ReactiveFlags.Pending);
	}
	let link = e.deps;
	while (link !== undefined) {
		const dep = link.dep;
		const depFlags = dep.flags;
		if (depFlags & EffectFlags.Queued) {
			run(dep, dep.flags = depFlags & ~EffectFlags.Queued);
		}
		link = link.nextDep;
	}
}

/**
 * 执行 pending effect 队列中的 effect
 */
function flush(): void {
  // 遍历 pending effect 队列，执行 effect
	while (notifyIndex < queuedEffectsLength) {
		const effect = queuedEffects[notifyIndex]!;
    // 执行完一个 effect，则将该 effect 从队列中移除
		queuedEffects[notifyIndex++] = undefined;
    // 执行 effect，同时重置 Queued 标志位
		run(effect, effect.flags &= ~EffectFlags.Queued);
	}
  // 全部执行完，重置索引和长度
	notifyIndex = 0;
	queuedEffectsLength = 0;
}

function computedOper<T>(this: Computed<T>): T {
	const flags = this.flags;
  // 检查标志位是否需要更新
	if (
    // 第一次进来，标志位为脏数据，则进行更新
		flags & 16 satisfies ReactiveFlags.Dirty
		||
    // signal 引起的标志位更新，检查是否真的是脏数据（实现懒加载，只有用到的时候才会重新计算）
    (flags & 32 satisfies ReactiveFlags.Pending && checkDirty(this.deps!, this))
	) {
    // 更新计算值
		if (updateComputed(this)) {
			const subs = this.subs;
			if (subs !== undefined) {
        // 通知订阅者（依赖该信号的节点）
				shallowPropagate(subs);
			}
		}
	}
  // 数据没有脏，则重置 Pending 标志位
	else if (flags & 32 satisfies ReactiveFlags.Pending) {
		this.flags = flags & ~(32 satisfies ReactiveFlags.Pending);
	}
  // 如果 activeSub 不为空，则将该信号添加到 activeSub 的订阅链表中（activeSub 实际指的就是 effect）
	if (activeSub !== undefined) {
		link(this, activeSub);
	} else if (activeScope !== undefined) {
		link(this, activeScope);
	}
	return this.value!;
}

function signalOper<T>(this: Signal<T>, ...value: [T]): T | void {
  // 存在 value 参数，则是 setter
	if (value.length) {
		const newValue = value[0];
    // 如果新值和旧值不相等，则更新值，并标记为脏数据
		if (this.value !== (this.value = newValue)) {
			this.flags = 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty;
			const subs = this.subs;
			if (subs !== undefined) {
        // 通知订阅者（依赖该信号的节点），将依赖添加到队列中，统一处理更新
        // propagate 的执行，只会讲其他订阅者的标志位进行更新，不会进行更新操作，来实现惰性加载
        // 后面会进行统一的 flush 批量更新操作
				propagate(subs);
        // 如果 batchDepth 为 0，则直接刷新队列进行更新，反之，则进行批量更新，不在这边处理
				if (!batchDepth) {
					flush();
				}
			}
		}
	}
  // 不存在 value 参数，则是 getter
  else {
		const value = this.value;
    // 如果标志位为脏数据，则更新值，并通知订阅者（依赖该信号的节点），然后再返回数据
		if (this.flags & 16 satisfies ReactiveFlags.Dirty) {
			if (updateSignal(this, value)) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		}
    // 如果 activeSub 不为空，则将该信号添加到 activeSub 的订阅链表中（activeSub 实际指的就是 effect）
		if (activeSub !== undefined) {
      // 依赖收集
			link(this, activeSub);
		}
		return value;
	}
}

// 返回一个 disposal 函数，用于清理依赖
function effectOper(this: Effect | EffectScope): void {
	let dep = this.deps;
  // 清理依赖（signal、computed）
	while (dep !== undefined) {
		dep = unlink(dep, this);
	}
  // 清理订阅（effectScope）
	const sub = this.subs;
	if (sub !== undefined) {
		unlink(sub);
	}
  // 清空标志位
	this.flags = 0 satisfies ReactiveFlags.None;
}

/**
 * untrack 根据逻辑自己实现一个不进行依赖追踪的函数，效果类似待删除的 pauseTracking
 * @example
 * const result = untracked(() => {
 *   return expensiveComputation(signal1(), signal2());
 * })
 */
export function untracked<T>(callback: () => T): T {
  const currentSub = setCurrentSub(undefined);
  try {
      return callback();
  } finally {
      setCurrentSub(currentSub);
  }
}
