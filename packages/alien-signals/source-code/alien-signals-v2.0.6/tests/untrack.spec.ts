import { expect, test } from 'vitest';
import { computed, effect, effectScope, setCurrentSub, signal } from '../src';

test('should pause tracking in computed', () => {
	const src = signal(0);

	let computedTriggerTimes = 0;
	const c = computed(() => {
		computedTriggerTimes++;
    // 设置当前的 activeSub 为 undefined，不进行依赖收集
		const currentSub = setCurrentSub(undefined);
		const value = src();
		setCurrentSub(currentSub);
		return value;
	});

	expect(c()).toBe(0);
	expect(computedTriggerTimes).toBe(1);

	src(1), src(2), src(3);
	expect(c()).toBe(0);
	expect(computedTriggerTimes).toBe(1);
});

test('should pause tracking in effect', () => {
	const src = signal(0);
	const is = signal(0);

	let effectTriggerTimes = 0;
	effect(() => {
		effectTriggerTimes++;
    // is 会加入到当前的 activeSub 的订阅链表中（activeSub 实际指的就是 effect）
    // 但 src 不会加入到当前的 activeSub 的订阅链表中，因为 setCurrentSub(undefined) 设置了当前的 activeSub 为 undefined
		if (is()) {
			const currentSub = setCurrentSub(undefined);
			src();
			setCurrentSub(currentSub);
		}
	});

	expect(effectTriggerTimes).toBe(1);

	is(1);
	expect(effectTriggerTimes).toBe(2);

	src(1), src(2), src(3);
	expect(effectTriggerTimes).toBe(2);

	is(2);
	expect(effectTriggerTimes).toBe(3);

	src(4), src(5), src(6);
	expect(effectTriggerTimes).toBe(3);

	is(0);
	expect(effectTriggerTimes).toBe(4);

	src(7), src(8), src(9);
	expect(effectTriggerTimes).toBe(4);
});

test('should pause tracking in effect scope', () => {
	const src = signal(0);

	let effectTriggerTimes = 0;
	effectScope(() => {
		effect(() => {
			effectTriggerTimes++;
			const currentSub = setCurrentSub(undefined);
			src();
			setCurrentSub(currentSub);
		});
	});

	expect(effectTriggerTimes).toBe(1);

	src(1), src(2), src(3);
	expect(effectTriggerTimes).toBe(1);
});
