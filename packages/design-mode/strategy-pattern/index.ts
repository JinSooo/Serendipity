/**
 * 策略模式
 *  用于避免多重条件选择语句，每次修改都要深入代码内部
 *  利用开放-封闭原则，将算法抽离到strategy中
 *  高阶函数也是一种方式
 */
const calculateBones = (fn: (...params) => any, salary: number) => {
  return fn(salary)
}

const A = (salary: number) => salary * 3
const B = (salary: number) => salary * 2

console.log(calculateBones(B, 5000))
