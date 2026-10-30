const form = document.querySelector('#idea-form');
const idea = document.querySelector('#idea');
const count = document.querySelector('#idea-count');
const button = document.querySelector('#submit');
const output = document.querySelector('#output');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderBanner(title, text, type = '') {
  const banner = element('div', `status-banner ${type}`.trim());
  banner.append(element('h3', '', title), element('p', '', text));
  return banner;
}

function renderList(title, items) {
  const section = element('section', 'result-section');
  const list = element('ul');
  items.forEach((item) => list.append(element('li', '', item)));
  section.append(element('h3', '', title), list);
  return section;
}

function renderNextStep(text) {
  const section = element('div', 'next-step');
  section.append(element('strong', '', 'Следующий шаг'), element('p', '', text));
  return section;
}

function renderResult(data) {
  const nodes = [];
  if (data.status === 'analysis') {
    nodes.push(renderBanner('Разбор готов', data.summary));
    nodes.push(renderList('Сильные стороны', data.strengths));
    nodes.push(renderList('Слабые места и риски', data.weaknesses));
    nodes.push(renderList('Вопросы инвестора', data.questions));
  } else if (data.status === 'clarification') {
    nodes.push(renderBanner('Нужно уточнить', data.summary, 'warning'));
    nodes.push(renderList('Ответьте на вопросы', data.questions));
  } else {
    nodes.push(renderBanner('Нужен профильный специалист', data.summary, 'warning'));
  }
  nodes.push(renderNextStep(data.next_step));
  output.replaceChildren(...nodes);
  output.focus({ preventScroll: true });
}

function renderError(message) {
  output.replaceChildren(renderBanner('Не удалось получить разбор', message, 'error'));
  output.focus({ preventScroll: true });
}

idea.addEventListener('input', () => {
  count.textContent = `${idea.value.length} / 4000`;
  idea.removeAttribute('aria-invalid');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = idea.value.trim();
  if (value.length < 40 || value.length > 4000) {
    idea.setAttribute('aria-invalid', 'true');
    idea.focus();
    renderError('Описание должно содержать от 40 до 4000 символов.');
    return;
  }

  button.disabled = true;
  button.firstElementChild.textContent = 'Анализируем...';
  output.setAttribute('aria-busy', 'true');
  const loading = element('div', 'loading');
  loading.append(element('span', 'spinner'), element('span', '', 'Проверяем идею и готовим разбор'));
  output.replaceChildren(loading);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: value }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Попробуйте ещё раз.');
    renderResult(data);
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'Ответ занял слишком много времени. Повторите запрос.'
      : error.message;
    renderError(message);
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    button.firstElementChild.textContent = 'Получить разбор';
    output.removeAttribute('aria-busy');
  }
});
