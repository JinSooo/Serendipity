interface ChildProps {
  name: string
  age: number
}

export default function Child(props: ChildProps) {
  return (
    <div>
      <div>name: {props.name}</div>
      <div>age: {props.age}</div>
    </div>
  )
}
