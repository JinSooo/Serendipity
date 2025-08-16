/** 响应式节点 */
export interface ReactiveNode {
  /** 依赖链表，指向该节点依赖的其他节点（链表头） */
	deps?: Link;
	/** 依赖链表，指向该节点依赖的其他节点（链表尾） */
	depsTail?: Link;
	/** 订阅链表，指向该节点被哪些节点依赖（链表头）（订阅该节点的其他节点） */
	subs?: Link;
	/** 订阅链表，指向该节点被哪些节点依赖（链表尾）（订阅该节点的其他节点） */
	subsTail?: Link;
	/** 标志：响应式节点状态 */
	flags: ReactiveFlags;
}

/**
 * Link 里面的内容就是 sub 和 dep 之间两个链表的关系（依赖链表，订阅链表）
 * Link 里面最基本的就是 sub 和 dep 两个节点，实现了最基本的关系 sub -> dep
 * - 依赖链表：指向 sub 的双向链表（从订阅者的角度）
 * - 订阅链表：指向 dep 的双向链表（从被依赖者的角度）
 */
/** 链表结构（用于依赖和子节点） */
export interface Link {
  /** 版本号，追踪依赖和订阅的版本 */
	version: number;
  // dep 和 sub 两个字段建立了基本的依赖关系：sub 依赖于 dep。
	/** 被依赖的节点（数据源） */
	dep: ReactiveNode;
	/** 订阅者节点（数据消费者） */
	sub: ReactiveNode;
  /**
   * 订阅者链表方向（从被依赖者角度）：
   *  prevSub: 指向同一个被依赖者的上一个订阅者链接
   *  nextSub: 指向同一个被依赖者的下一个订阅者链接
   */
	/** 指向同一依赖的上一个订阅者链接 */
	prevSub: Link | undefined;
	/** 指向同一依赖的下一个订阅者链接 */
	nextSub: Link | undefined;
  /**
   * 依赖链表方向（从订阅者角度）：
   *  prevDep: 指向同一个订阅者的上一个依赖链接
   *  nextDep: 指向同一个订阅者的下一个依赖链接
   */
	/** 指向同一订阅者的上一个依赖链接 */
	prevDep: Link | undefined;
	/** 指向同一订阅者的下一个依赖链接 */
	nextDep: Link | undefined;
}

interface Stack<T> {
	value: T;
	prev: Stack<T> | undefined;
}

/** 标志：响应式节点状态 */
export enum ReactiveFlags {
	None = 0,
	/** 响应式标志 */
	Mutable = 1 << 0,
	/** 节点被监听 */
	Watching = 1 << 1,
	/** 依赖检测（表示节点正在被递归检查，防止重复进入检查过程） */
	RecursedCheck = 1 << 2,
	/** 是否是递归依赖链的一部分（表示节点是递归依赖链的一部分，用于检测和处理循环依赖） */
	Recursed = 1 << 3,
	/** 脏数据，需要更新 */
	Dirty = 1 << 4,
	/** 等待更新调度，还没执行（表示节点等待更新，避免重复处理同一个节点） */
	Pending = 1 << 5,
}

export function createReactiveSystem({
	update,
	notify,
	unwatched,
}: {
	/** 处理节点更新（当节点需要重新计算） */
	update(sub: ReactiveNode): boolean;
	/** 触发副作用（当节点改变时，通知观察者） */
	notify(sub: ReactiveNode): void;
	/** 清除函数（当节点不再被任何观察者监听） */
	unwatched(sub: ReactiveNode): void;
}) {
	let currentVersion = 0;
	return {
		link,
		unlink,
		propagate,
		checkDirty,
		endTracking,
		startTracking,
		shallowPropagate,
	};

  // 订阅依赖，sub -> dep（实现 O(1) 插入）
	function link(dep: ReactiveNode, sub: ReactiveNode): void {
    // prevDep 指向 sub 的依赖链表的原链尾
    const prevDep = sub.depsTail;
    // 检查是否已经存在依赖关系，如果存在，则直接返回
		if (prevDep !== undefined && prevDep.dep === dep) {
			return;
		}
    // nextDep 指向 sub 的依赖链表的链头
		const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
    // 检查是否已经存在依赖关系，如果存在，则直接返回
		if (nextDep !== undefined && nextDep.dep === dep) {
			nextDep.version = currentVersion;
			sub.depsTail = nextDep;
			return;
		}
    // prevSub 指向 dep 的订阅链表的原链尾
		const prevSub = dep.subsTail;
    // 检查是否已经存在订阅关系，如果存在，则直接返回
		if (prevSub !== undefined && prevSub.version === currentVersion && prevSub.sub === sub) {
			return;
		}
    // 创建新的 Link
		const newLink
			= sub.depsTail
			= dep.subsTail
      // Link 里面的内容就是 sub 和 dep 之间两个链表的关系（依赖链表，订阅链表）
			= {
				version: currentVersion,
				dep,
				sub,
				prevDep,
				nextDep,
				prevSub,
				nextSub: undefined,
			};
    // 双向链表插入逻辑
		if (nextDep !== undefined) {
			nextDep.prevDep = newLink;
		}
		if (prevDep !== undefined) {
			prevDep.nextDep = newLink;
		} else {
			sub.deps = newLink;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = newLink;
		} else {
			dep.subs = newLink;
		}
	}

  /**
   * 取消订阅依赖，sub <- dep（实现 O(1) 删除）
   */
	function unlink(link: Link, sub = link.sub): Link | undefined {
		const dep = link.dep;
		const prevDep = link.prevDep;
		const nextDep = link.nextDep;
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;
    // 双向链表删除逻辑
		if (nextDep !== undefined) {
			nextDep.prevDep = prevDep;
		} else {
			sub.depsTail = prevDep;
		}
		if (prevDep !== undefined) {
			prevDep.nextDep = nextDep;
		} else {
			sub.deps = nextDep;
		}
		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
		} else {
			dep.subsTail = prevSub;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		} else if ((dep.subs = nextSub) === undefined) {
      // 如果 dep 的订阅链表为空，则调用清理函数
			unwatched(dep);
		}
		return nextDep;
	}

  /**
   * 传播更新，通过 Link 通知所有订阅者
   */
	function propagate(link: Link): void {
		let next = link.nextSub;
		let stack: Stack<Link | undefined> | undefined;

		top: do {
			const sub = link.sub;

			let flags = sub.flags;

      // 如果节点没有任何特殊标志，标记为 Pending
      /**
       * 使用条件：
       *  - 节点是第一次访问
       *  - 节点处于干净状态（最常见）
       */
			if (!(flags & 60 as ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending)) {
				sub.flags = flags | 32 satisfies ReactiveFlags.Pending;
			}
      // 如果节点正在被递归检查，重置标志
      /**
       * 使用条件：
       *  - 节点正在被递归检查，但还没有被标记为递归依赖（需要重置状态，避免重复处理）
       */
      else if (!(flags & 12 as ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed)) {
				flags = 0 satisfies ReactiveFlags.None;
			}
      // 如果节点是递归依赖的一部分，标记为 Pending
      /**
       * 使用条件：
       *  - 节点是递归依赖链的一部分（需要清除 Recursed 标志，但保持 Pending 状态：为的是防止循环依赖）
       */
      else if (!(flags & 4 satisfies ReactiveFlags.RecursedCheck)) {
				sub.flags = (flags & ~(8 satisfies ReactiveFlags.Recursed)) | 32 satisfies ReactiveFlags.Pending;
			}
      // 如果节点是可变且链接有效，标记为 Recursed | Pending
      /**
       * 使用条件：
       *  - 节点既不是 Dirty 也不是 Pending（当一个信号（Signal）变化时，它需要标记为 Recursed | Pending，这样它的订阅者也会被传播到）
       */
      else if (!(flags & 48 as ReactiveFlags.Dirty | ReactiveFlags.Pending) && isValidLink(link, sub)) {
				sub.flags = flags | 40 as ReactiveFlags.Recursed | ReactiveFlags.Pending;
				flags &= 1 satisfies ReactiveFlags.Mutable;
			} else {
				flags = 0 satisfies ReactiveFlags.None;
			}

      // 如果节点被监听，调用 notify 函数通知订阅者
			if (flags & 2 satisfies ReactiveFlags.Watching) {
				notify(sub);
			}

      // 如果节点是可变的且存在订阅者，则递归传播
			if (flags & 1 satisfies ReactiveFlags.Mutable) {
				const subSubs = sub.subs;
				if (subSubs !== undefined) {
					const nextSub = (link = subSubs).nextSub;
					if (nextSub !== undefined) {
						stack = { value: next, prev: stack };
						next = nextSub;
					}
					continue;
				}
			}

			if ((link = next!) !== undefined) {
				next = link.nextSub;
				continue;
			}

      // 使用栈结构实现深度优先遍历
			while (stack !== undefined) {
				link = stack.value!;
				stack = stack.prev;
				if (link !== undefined) {
					next = link.nextSub;
					continue top;
				}
			}

			break;
		} while (true);
	}

  /**
   * 开启新一轮跟踪
   */
	function startTracking(sub: ReactiveNode): void {
		++currentVersion;
		sub.depsTail = undefined;
    // 重置状态，并设置 RecursedCheck 标志，用于检测循环依赖
		sub.flags = (sub.flags & ~(56 as ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending)) | 4 satisfies ReactiveFlags.RecursedCheck;
	}

  /**
   * 结束一轮跟踪
   */
	function endTracking(sub: ReactiveNode): void {
		const depsTail = sub.depsTail;
		let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
    // 清除依赖链表
		while (toRemove !== undefined) {
			toRemove = unlink(toRemove, sub);
		}
    // 重置 RecursedCheck 标志
		sub.flags &= ~(4 satisfies ReactiveFlags.RecursedCheck);
	}

  /**
   * 检查节点是否脏了（是否需要更新）
   */
	function checkDirty(link: Link, sub: ReactiveNode): boolean {
		let stack: Stack<Link> | undefined;
		let checkDepth = 0;

		top: do {
			const dep = link.dep;
			const depFlags = dep.flags;

			let dirty = false;

      // 如果数据已经脏了，直接返回 true
			if (sub.flags & 16 satisfies ReactiveFlags.Dirty) {
				dirty = true;
			}
      // 如果依赖节点是可变的且脏了，调用 update 函数更新依赖节点
      else if ((depFlags & 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty) === 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty) {
				if (update(dep)) {
					const subs = dep.subs!;
					if (subs.nextSub !== undefined) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			}
      // 如果依赖节点是可变的且等待更新，则递归检查依赖
      else if ((depFlags & 33 as ReactiveFlags.Mutable | ReactiveFlags.Pending) === 33 as ReactiveFlags.Mutable | ReactiveFlags.Pending) {
				if (link.nextSub !== undefined || link.prevSub !== undefined) {
					stack = { value: link, prev: stack };
				}
				link = dep.deps!;
				sub = dep;
				++checkDepth;
				continue;
			}

      // 依赖链遍历
			if (!dirty) {
				const nextDep = link.nextDep;
				if (nextDep !== undefined) {
					link = nextDep;
					continue;
				}
			}

      // 深度回溯处理
			while (checkDepth) {
				--checkDepth;
				const firstSub = sub.subs!;
				const hasMultipleSubs = firstSub.nextSub !== undefined;
				if (hasMultipleSubs) {
					link = stack?.value;
					stack = stack?.prev;
				} else {
					link = firstSub;
				}
        // 如果是脏数据，则尝试更新数据
				if (dirty) {
					if (update(sub)) {
						if (hasMultipleSubs) {
							shallowPropagate(firstSub);
						}
						sub = link.sub;
						continue;
					}
				} else {
					sub.flags &= ~(32 satisfies ReactiveFlags.Pending);
				}
        // 继续处理下一个依赖
				sub = link.sub;
				if (link.nextDep !== undefined) {
					link = link.nextDep;
					continue top;
				}
				dirty = false;
			}

			return dirty;
		} while (true);
	}

  /**
   * 浅层传播更新，只通知订阅者，不递归检查依赖
   * @param link 要传播的链接
   */
	function shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const nextSub = link.nextSub;
			const subFlags = sub.flags;
			if ((subFlags & 48 as ReactiveFlags.Pending | ReactiveFlags.Dirty) === 32 satisfies ReactiveFlags.Pending) {
				sub.flags = subFlags | 16 satisfies ReactiveFlags.Dirty;
				if (subFlags & 2 satisfies ReactiveFlags.Watching) {
					notify(sub);
				}
			}
			link = nextSub!;
		} while (link !== undefined);
	}

  /**
   * 检查链接是否有效
   * @param checkLink 要检查的链接
   * @param sub 被依赖的节点
   */
	function isValidLink(checkLink: Link, sub: ReactiveNode): boolean {
		const depsTail = sub.depsTail;
		if (depsTail !== undefined) {
			let link = sub.deps!;
			do {
				if (link === checkLink) {
					return true;
				}
				if (link === depsTail) {
					break;
				}
				link = link.nextDep!;
			} while (link !== undefined);
		}
		return false;
	}
}
