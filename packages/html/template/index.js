const newTodoInput = document.getElementById('newTodo')
const todoList = document.getElementById('todoList')
const todoTemplate = document.getElementById('todoTemplate').content

const addTodo = todoText => {
  // 克隆模板内容
  // const clone = todoTemplate.cloneNode(true)
  const clone = document.importNode(todoTemplate, true)
  const todoSpan = clone.querySelector('span')
  todoSpan.textContent = todoText

  todoList.appendChild(clone)
}

newTodoInput.addEventListener('keypress', function (event) {
  if (event.key === 'Enter') {
    const todoText = this.value.trim()
    if (todoText) {
      addTodo(todoText)
      this.value = ''
    }
  }
})

addTodo('写文章')
