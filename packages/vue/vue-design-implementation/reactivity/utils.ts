export const isSet = (obj): obj is Set => obj.toString() === '[object Set]'

export const isMap = (obj): obj is Map => obj.toString() === '[object Map]'
