import { type Accessor, type Signal, onCleanup } from 'solid-js'

/**
 * 指令，点击元素外部时触发
 */
export default function clickOutside(el: HTMLElement, accessor: Accessor<Signal<boolean>>) {
  const handleClick = e => {
    !el.contains(e.target) && accessor()?.()
    console.log('click')
  }

  document.body.addEventListener('click', handleClick)
  onCleanup(() => {
    document.body.removeEventListener('click', handleClick)
  })
}
