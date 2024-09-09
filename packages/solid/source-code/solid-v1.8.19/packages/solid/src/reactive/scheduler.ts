// Basic port modification of Reacts Scheduler: https://github.com/facebook/react/tree/master/packages/scheduler
export interface Task {
  id: number;
  fn: ((didTimeout: boolean) => void) | null;
  startTime: number;
  expirationTime: number;
}

// experimental new feature proposal stuff
type NavigatorScheduling = Navigator & {
  scheduling: { isInputPending?: () => boolean };
};

let taskIdCounter = 1,
  isCallbackScheduled = false,
  /**
    当时是否在执行任务
   */
  isPerformingWork = false,
  taskQueue: Task[] = [],
  currentTask: Task | null = null,
  /**
    利用 navigator.scheduling & deadline & yieldInterval 判断是否需要让出线程给 Host
   */
  shouldYieldToHost: (() => boolean) | null = null,
  yieldInterval = 5,
  deadline = 0,
  maxYieldInterval = 300,
  /**
    用于在下一次浏览器执行时，插入一条宏任务
   */
  scheduleCallback: (() => void) | null = null,
  /**
    用于宏任务中进行调度的回调，与 scheduleCallback 结合，实现分片
   */
  scheduledCallback: ((hasTimeRemaining: boolean, initialTime: number) => boolean) | null = null;

const maxSigned31BitInt = 1073741823;
/* istanbul ignore next */
function setupScheduler() {
  // 利用 MessageChannel 实现宏任务调度
  const channel = new MessageChannel(),
    port = channel.port2;
    /**
      在每次调度的最后，执行一次 postMessage，然后就可以把 onmessage 任务加入到下一次的宏任务队列了
      而这个宏任务就会在下一次浏览器渲染完成之后去执行，这样就不会影响浏览器
      也是通过这种方式实现把整个调度任务切分成很多小任务
     */
  scheduleCallback = () => port.postMessage(null);
  channel.port1.onmessage = () => {
    // scheduledCallback -> flushWork
    if (scheduledCallback !== null) {
      const currentTime = performance.now();
      deadline = currentTime + yieldInterval;
      const hasTimeRemaining = true;
      try {
        const hasMoreWork = scheduledCallback(hasTimeRemaining, currentTime);
        if (!hasMoreWork) {
          scheduledCallback = null;
        } else port.postMessage(null);
      } catch (error) {
        // If a scheduler task throws, exit the current browser task so the
        // error can be observed.
        port.postMessage(null);
        throw error;
      }
    }
  };

  if (
    navigator &&
    (navigator as NavigatorScheduling).scheduling &&
    (navigator as NavigatorScheduling).scheduling.isInputPending
  ) {
    const scheduling = (navigator as NavigatorScheduling).scheduling;
    // 判断是否要让出线程给主线程
    shouldYieldToHost = () => {
      const currentTime = performance.now();
      if (currentTime >= deadline) {
        // There's no time left. We may want to yield control of the main
        // thread, so the browser can perform high priority tasks. The main ones
        // are painting and user input. If there's a pending paint or a pending
        // input, then we should yield. But if there's neither, then we can
        // yield less often while remaining responsive. We'll eventually yield
        // regardless, since there could be a pending paint that wasn't
        // accompanied by a call to `requestPaint`, or other main thread tasks
        // like network events.
        if (scheduling.isInputPending!()) {
          return true;
        }
        // There's no pending input. Only yield if we've reached the max
        // yield interval.
        return currentTime >= maxYieldInterval;
      } else {
        // There's still time left in the frame.
        return false;
      }
    };
  } else {
    // `isInputPending` is not available. Since we have no way of knowing if
    // there's pending input, always yield at the end of the frame.
    shouldYieldToHost = () => performance.now() >= deadline;
  }
}

function enqueue(taskQueue: Task[], task: Task) {
  // 按过期时间找到插入位置
  function findIndex() {
    let m = 0;
    let n = taskQueue.length - 1;

    while (m <= n) {
      const k = (n + m) >> 1;
      const cmp = task.expirationTime - taskQueue[k].expirationTime;
      if (cmp > 0) m = k + 1;
      else if (cmp < 0) n = k - 1;
      else return k;
    }
    return m;
  }
  taskQueue.splice(findIndex(), 0, task);
}

export function requestCallback(fn: () => void, options?: { timeout: number }): Task {
  // 通过初始化 setupScheduler，生成一个 scheduleCallback，用于调度到下一次宏任务作为收尾
  if (!scheduleCallback) setupScheduler();
  let startTime = performance.now(),
    timeout = maxSigned31BitInt;

  if (options && options.timeout) timeout = options.timeout;

  const newTask: Task = {
    id: taskIdCounter++,
    fn,
    startTime,
    expirationTime: startTime + timeout
  };

  enqueue(taskQueue, newTask);
  if (!isCallbackScheduled && !isPerformingWork) {
    isCallbackScheduled = true;
    scheduledCallback = flushWork;
    // 这里会调度该宏任务
    scheduleCallback!();
  }

  return newTask;
}

export function cancelCallback(task: Task) {
  task.fn = null;
}

function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  // We'll need a host callback the next time work is scheduled.
  isCallbackScheduled = false;
  isPerformingWork = true;
  try {
    return workLoop(hasTimeRemaining, initialTime);
  } finally {
    currentTask = null;
    isPerformingWork = false;
  }
}

function workLoop(hasTimeRemaining: boolean, initialTime: number) {
  let currentTime = initialTime;
  currentTask = taskQueue[0] || null;
  while (currentTask !== null) {
    // task expired or no time remain
    if (currentTask.expirationTime > currentTime && (!hasTimeRemaining || shouldYieldToHost!())) {
      // This currentTask hasn't expired, and we've reached the deadline.
      break;
    }
    // execute task
    const callback = currentTask.fn;
    if (callback !== null) {
      currentTask.fn = null;
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      callback(didUserCallbackTimeout);
      currentTime = performance.now();
      if (currentTask === taskQueue[0]) {
        taskQueue.shift();
      }
    } else taskQueue.shift();
    // update new task to be executed
    currentTask = taskQueue[0] || null;
  }
  // if currentTask is null, it's explained that there is none of tasks
  // Return whether there's additional work
  return currentTask !== null;
}
