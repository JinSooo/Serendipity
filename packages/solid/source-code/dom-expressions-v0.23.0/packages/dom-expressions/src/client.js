import {
  Properties,
  ChildProperties,
  Aliases,
  getPropAlias,
  SVGNamespace,
  DelegatedEvents
} from "./constants";
/**
rxcore 是不是一个库，是一个特殊名词，在 babel 插件中会对其进行转换
{
  original: "rxcore",
  replacement: __dirname + "/core"
}
这在 README 中也有说明
rxcore 主要是用于提供基本的响应式内容，如 reactivity、effect、signal 等

而在 Solid 中使用，会将 rxcore 的路径转为
{
  original: "rxcore",
  replacement: path.join(__dirname, "../../packages/solid/web/src/core")
}
 */
import {
  root,
  effect,
  memo,
  getOwner,
  createComponent,
  sharedConfig,
  untrack,
  mergeProps
} from "rxcore";
import reconcileArrays from "./reconcile";
export {
  Properties,
  ChildProperties,
  getPropAlias,
  Aliases,
  DOMElements,
  SVGElements,
  SVGNamespace,
  DelegatedEvents
} from "./constants";

const $$EVENTS = "_$DX_DELEGATE";

export {
  effect,
  memo,
  untrack,
  getOwner,
  createComponent,
  mergeProps,
  voidFn as useAssets,
  voidFn as getAssets,
  voidFn as Assets,
  voidFn as generateHydrationScript,
  voidFn as HydrationScript,
  voidFn as getRequestEvent
};

export function render(code, element, init, options = {}) {
  if ("_DX_DEV_" && !element) {
    throw new Error(
      "The `element` passed to `render(..., element)` doesn't exist. Make sure `element` exists in the document."
    );
  }
  // disposer 用于接收 root（createRoot）的清理函数
  let disposer;
  root(dispose => {
    disposer = dispose;
    element === document
      // code 实质就是一个 createComponent 函数，它会经过编译返回一个 JSX.Element
      ? code()
      : insert(element, code(), element.firstChild ? null : undefined, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}

// 根据 html 字符串创建一个模板元素
export function template(html, isCE, isSVG) {
  let node;
  const create = () => {
    if ("_DX_DEV_" && isHydrating())
      throw new Error(
        "Failed attempt to create new DOM elements during hydration. Check that the libraries you are using support hydration."
      );
    const t = document.createElement("template");
    t.innerHTML = html;
    return isSVG ? t.content.firstChild.firstChild : t.content.firstChild;
  };
  // backwards compatible with older builds
  const fn = isCE
    ? () => untrack(() => document.importNode(node || (node = create()), true))
    // 返回一个克隆的节点，然后再对其进行操作
    : () => (node || (node = create())).cloneNode(true);
  // 做缓存处理
  fn.cloneNode = fn;
  return fn;
}

// 添加事件代理，对指定的事件添加到 document 上进行代理
export function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      // 添加对应的事件处理函数
      // name 和正常事件名称一直，但组件元素的事件名称是 $$xxx 这种形式，可以在 eventHandler 中看到
      document.addEventListener(name, eventHandler);
    }
  }
}

export function clearDelegatedEvents(document = window.document) {
  if (document[$$EVENTS]) {
    for (let name of document[$$EVENTS].keys()) document.removeEventListener(name, eventHandler);
    delete document[$$EVENTS];
  }
}

export function setProperty(node, name, value) {
  if (isHydrating(node)) return;
  node[name] = value;
}

export function setAttribute(node, name, value) {
  if (isHydrating(node)) return;
  if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}

export function setAttributeNS(node, namespace, name, value) {
  if (isHydrating(node)) return;
  if (value == null) node.removeAttributeNS(namespace, name);
  else node.setAttributeNS(namespace, name, value);
}

export function className(node, value) {
  if (isHydrating(node)) return;
  if (value == null) node.removeAttribute("class");
  else node.className = value;
}

export function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, (handler[0] = e => handlerFn.call(node, handler[1], e)));
  } else node.addEventListener(name, handler);
}

export function classList(node, value, prev = {}) {
  const classKeys = Object.keys(value || {}),
    prevKeys = Object.keys(prev);
  let i, len;
  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value[key]) continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }
  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = !!value[key];
    if (!key || key === "undefined" || prev[key] === classValue || !classValue) continue;
    toggleClassKey(node, key, true);
    prev[key] = classValue;
  }
  return prev;
}

export function style(node, value, prev) {
  if (!value) return prev ? setAttribute(node, "style") : value;
  const nodeStyle = node.style;
  if (typeof value === "string") return (nodeStyle.cssText = value);
  typeof prev === "string" && (nodeStyle.cssText = prev = undefined);
  prev || (prev = {});
  value || (value = {});
  let v, s;
  for (s in prev) {
    value[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }
  for (s in value) {
    v = value[s];
    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }
  return prev;
}

export function spread(node, props = {}, isSVG, skipChildren) {
  const prevProps = {};
  if (!skipChildren) {
    effect(() => (prevProps.children = insertExpression(node, props.children, prevProps.children)));
  }
  effect(() => typeof props.ref === "function" && use(props.ref, node));
  effect(() => assign(node, props, isSVG, true, prevProps, true));
  return prevProps;
}

export function dynamicProperty(props, key) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() {
      return src();
    },
    enumerable: true
  });
  return props;
}

export function use(fn, element, arg) {
  return untrack(() => fn(element, arg));
}

// 插入节点到元素 DOM 中
export function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);

  /**
    这种情况用于，响应式处理的，如 _$insert(_el$, () => props.a);
    这时候的 props.a 实质上是父组件传递的一个 Signal，所以需要通过 effect 去做监听
   */
  effect(current => insertExpression(parent, accessor(), current, marker), initial);
}

export function assign(node, props, isSVG, skipChildren, prevProps = {}, skipRef = false) {
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], isSVG, skipRef);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren) insertExpression(node, props.children);
      continue;
    }
    const value = props[prop];
    prevProps[prop] = assignProp(node, prop, value, prevProps[prop], isSVG, skipRef);
  }
}

// Hydrate
export function hydrate(code, element, options = {}) {
  // 浏览器和服务器之间有一些共享的内容，就是利用 sharedConfig 来传递的
  // 而 sharedConfig 最终会存储在 _$HY 和 [data-hk] 当中
  // 浏览器渲染时，就会从 _$HY 中获取 sharedConfig 的内容，然后进行渲染
  // hydrate 最终也是调用 render 方法，只是后续过程中会对 sharedConfig 进行处理

  if (globalThis._$HY.done) return render(code, element, [...element.childNodes], options);
  sharedConfig.completed = globalThis._$HY.completed;
  sharedConfig.events = globalThis._$HY.events;
  // 在服务器端渲染时，会将一些数据序列化并通过 _$HY.r 传递给客户端
  sharedConfig.load = id => globalThis._$HY.r[id];
  sharedConfig.has = id => id in globalThis._$HY.r;
  sharedConfig.gather = root => gatherHydratable(element, root);
  // 存储所有需要 hydrate 的节点
  sharedConfig.registry = new Map();
  sharedConfig.context = {
    id: options.renderId || "",
    count: 0
  };
  try {
    // 会找到所有 [data-hk] 节点，存储到 sharedConfig.registry，会在 getNextElement shi复用
    gatherHydratable(element, options.renderId);
    return render(code, element, [...element.childNodes], options);
  } finally {
    sharedConfig.context = null;
  }
}

export function getNextElement(template) {
  let node,
    key,
    // 是否处于 hydrating 状态
    hydrating = isHydrating();
    // 在 gatherHydratable 会找到所有 [data-hk] 节点，存储到 sharedConfig.registry
    // 通过 getHydrationKey 从 sharedConfig.registry 中获取对应的节点
    // 省去创建节点的步骤，直接复用
  if (!hydrating || !(node = sharedConfig.registry.get((key = getHydrationKey())))) {
    if ("_DX_DEV_" && hydrating)
      throw new Error(`Hydration Mismatch. Unable to find DOM nodes for hydration key: ${key}`);
    // 如果不处于 hydrating 状态 或者没找到该 node，则正常创建节点
    return template();
  }
  if (sharedConfig.completed) sharedConfig.completed.add(node);
  sharedConfig.registry.delete(key);
  // 返回找到的复用节点
  return node;
}

export function getNextMatch(el, nodeName) {
  while (el && el.localName !== nodeName) el = el.nextSibling;
  return el;
}

/**
 * 找到一个 hydration 边界，从 start - end 之间，找到一个注释节点，用于后续插入 Signal
 * 注释节点：<!$><!/>（nodeType = 8）
 */
export function getNextMarker(start) {
  let end = start,
    count = 0,
    current = [];
  // 
  if (isHydrating(start)) {
    while (end) {
      if (end.nodeType === 8) {
        const v = end.nodeValue;
        // 找到 <!$> 节点，count++
        if (v === "$") count++;
        // 找到 <!/> 节点，count--
        else if (v === "/") {
          // 如果 count === 0，则表示已经找到一个完整的 hydration 边界
          // 可以做后续的 Signal 插入，insertExpression 中会用到
          if (count === 0) return [end, current];
          count--;
        }
      }
      current.push(end);
      end = end.nextSibling;
    }
  }
  return [end, current];
}

/**
 * 执行 hydrate 过程中元素产生的事件
 */
export function runHydrationEvents() {
  if (sharedConfig.events && !sharedConfig.events.queued) {
    // 确保事件处理在当前执行栈清空后进行，避免阻塞主线程
    queueMicrotask(() => {
      const { completed, events } = sharedConfig;
      events.queued = false;
      while (events.length) {
        const [el, e] = events[0];
        if (!completed.has(el)) return;
        events.shift();
        eventHandler(e);
      }
      if (sharedConfig.done) {
        sharedConfig.events = _$HY.events = null;
        sharedConfig.completed = _$HY.completed = null;
      }
    });
    sharedConfig.events.queued = true;
  }
}

// Internal Functions
function isHydrating(node) {
  return !!sharedConfig.context && !sharedConfig.done && (!node || node.isConnected);
}

function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}

function toggleClassKey(node, key, value) {
  const classNames = key.trim().split(/\s+/);
  for (let i = 0, nameLen = classNames.length; i < nameLen; i++)
    node.classList.toggle(classNames[i], value);
}

function assignProp(node, prop, value, prev, isSVG, skipRef) {
  let isCE, isProp, isChildProp, propAlias, forceProp;
  if (prop === "style") return style(node, value, prev);
  if (prop === "classList") return classList(node, value, prev);
  if (value === prev) return prev;
  if (prop === "ref") {
    if (!skipRef) value(node);
  } else if (prop.slice(0, 3) === "on:") {
    const e = prop.slice(3);
    prev && node.removeEventListener(e, prev);
    value && node.addEventListener(e, value);
  } else if (prop.slice(0, 10) === "oncapture:") {
    const e = prop.slice(10);
    prev && node.removeEventListener(e, prev, true);
    value && node.addEventListener(e, value, true);
  } else if (prop.slice(0, 2) === "on") {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      const h = Array.isArray(prev) ? prev[0] : prev;
      node.removeEventListener(name, h);
    }
    if (delegate || value) {
      addEventListener(node, name, value, delegate);
      delegate && delegateEvents([name]);
    }
  } else if (prop.slice(0, 5) === "attr:") {
    setAttribute(node, prop.slice(5), value);
  } else if (
    (forceProp = prop.slice(0, 5) === "prop:") ||
    (isChildProp = ChildProperties.has(prop)) ||
    (!isSVG &&
      ((propAlias = getPropAlias(prop, node.tagName)) || (isProp = Properties.has(prop)))) ||
    (isCE = node.nodeName.includes("-"))
  ) {
    if (forceProp) {
      prop = prop.slice(5);
      isProp = true;
    } else if (isHydrating(node)) return value;
    if (prop === "class" || prop === "className") className(node, value);
    else if (isCE && !isProp && !isChildProp) node[toPropertyName(prop)] = value;
    else node[propAlias || prop] = value;
  } else {
    const ns = isSVG && prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);
    else setAttribute(node, Aliases[prop] || prop, value);
  }
  return value;
}

function eventHandler(e) {
  if (sharedConfig.registry && sharedConfig.events) {
    if (sharedConfig.events.find(([el, ev]) => ev === e)) return;
  }

  // 可以看到，是 $$click 这种形式
  const key = `$$${e.type}`;
  let node = (e.composedPath && e.composedPath()[0]) || e.target;
  // reverse Shadow DOM retargetting
  if (e.target !== node) {
    Object.defineProperty(e, "target", {
      configurable: true,
      value: node
    });
  }

  // simulate currentTarget
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  // cancel hydration
  if (sharedConfig.registry && !sharedConfig.done) sharedConfig.done = _$HY.done = true;

  // 这里进行处理
  while (node) {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node = node._$host || node.parentNode || node.host;
  }
}

/**
 * 插入节点
 * @param {*} parent 插入或更新内容的父节点
 * @param {*} value 插入或更新的新值。它可以是简单的文本、数字，也可以是复杂的函数或数组
 * @param {*} current 当前已存在的内容。用于比较和决定如何更新 DOM
 * @param {*} marker 一个标记节点，用于指示在哪里插入新内容。主要用于列表渲染等场景，确保正确的插入位置
 * @param {*} unwrapArray 是否解包数组
 */
function insertExpression(parent, value, current, marker, unwrapArray) {
  const hydrating = isHydrating(parent);
  if (hydrating) {
    !current && (current = [...parent.childNodes]);
    let cleaned = [];
    for (let i = 0; i < current.length; i++) {
      const node = current[i];
      if (node.nodeType === 8 && node.data.slice(0, 2) === "!$") node.remove();
      else cleaned.push(node);
    }
    current = cleaned;
  }
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value,
    multi = marker !== undefined;
  parent = (multi && current[0] && current[0].parentNode) || parent;

  if (t === "string" || t === "number") {
    if (hydrating) return current;
    if (t === "number") {
      value = value.toString();
      if (value === current) return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value && (node.data = value);
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    if (hydrating) return current;
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    effect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value, current, unwrapArray)) {
      effect(() => (current = insertExpression(parent, array, current, marker, true)));
      return () => current;
    }
    if (hydrating) {
      if (!array.length) return current;
      if (marker === undefined) return (current = [...parent.childNodes]);
      let node = array[0];
      if (node.parentNode !== parent) return current;
      const nodes = [node]
      while ((node = node.nextSibling) !== marker) nodes.push(node);
      return (current = nodes);
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value.nodeType) {
    if (hydrating && value.parentNode) return (current = multi ? [value] : value);
    if (Array.isArray(current)) {
      if (multi) return (current = cleanChildren(parent, current, marker, value));
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else if ("_DX_DEV_") console.warn(`Unrecognized value. Skipped inserting`, value);

  return current;
}

function normalizeIncomingArray(normalized, array, current, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
      prev = current && current[normalized.length],
      t;
    if (item == null || item === true || item === false) {
      // matches null, undefined, true or false
      // skip
    } else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();
        dynamic =
          normalizeIncomingArray(
            normalized,
            Array.isArray(item) ? item : [item],
            Array.isArray(prev) ? prev : [prev]
          ) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value) normalized.push(prev);
      else normalized.push(document.createTextNode(value));
    }
  }
  return dynamic;
}

function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}

function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return (parent.textContent = "");
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i)
          isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);
        else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}

function gatherHydratable(element, root) {
  // 这里用到了 data-hk 数据，来自于 ssrHydrationKey，在 ssr 中会生成该数据
  // 浏览器 hydrate 的时候，会读取该值
  const templates = element.querySelectorAll(`*[data-hk]`);
  for (let i = 0; i < templates.length; i++) {
    const node = templates[i];
    const key = node.getAttribute("data-hk");
    // 数据会添加到 sharedConfig.registry 中
    if ((!root || key.startsWith(root)) && !sharedConfig.registry.has(key))
      // 将所有需要 hydrate 的节点存储在 sharedConfig.registry 中，供后续节点复用（无需创建）
      sharedConfig.registry.set(key, node);
  }
}

export function getHydrationKey() {
  return sharedConfig.getNextContextId();
}

export function NoHydration(props) {
  return sharedConfig.context ? undefined : props.children;
}

export function Hydration(props) {
  return props.children;
}

const voidFn = () => undefined;

// experimental
export const RequestContext = Symbol();

// deprecated
export function innerHTML(parent, content) {
  !sharedConfig.context && (parent.innerHTML = content);
}
