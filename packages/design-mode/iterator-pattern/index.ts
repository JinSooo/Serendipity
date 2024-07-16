/**
 * 迭代器模式
 *  - 内部迭代器：手动控制，如 [[Symbol.Iterator]]
 *  - 外部迭代器：通过函数，如 forEach
 */

const iteratorUploadObj = (...params) => {
  for (const fn of params) {
    const uploadObj = fn()
    if (uploadObj) {
      return uploadObj
    }
  }
}

const getActiveUploadObj = () => {
  try {
    return 'getActiveUploadObj'
  } catch {
    return false
  }
}
const getFlashUploadObj = () => {
  try {
    return 'getActiveUploadObj'
  } catch {
    return false
  }
}

console.log(iteratorUploadObj(getActiveUploadObj, getFlashUploadObj))
