import { createServer } from 'node:http';

function responseFor(idea) {
  if (/договор|дол[юя]/i.test(idea)) {
    return {
      status: 'handoff', summary: 'Этот запрос требует юридической и финансовой экспертизы.',
      strengths: [], weaknesses: [], questions: [],
      next_step: 'Обратитесь к корпоративному юристу и финансовому консультанту.',
    };
  }
  if (/данных пока нет|приложение для бизнеса/i.test(idea)) {
    return {
      status: 'clarification', summary: 'Для анализа не хватает описания продукта, аудитории и проблемы.',
      strengths: [], weaknesses: [],
      questions: ['Что делает продукт?', 'Кто основной пользователь?', 'Какую проблему он решает?'],
      next_step: 'Дополните описание и отправьте его повторно.',
    };
  }
  return {
    status: 'analysis', summary: 'Идея решает понятную задачу, но спрос ещё нужно подтвердить.',
    strengths: ['Понятная аудитория', 'Результат связан с питчингом', 'Короткий путь до разбора'],
    weaknesses: ['Спрос не подтверждён', 'Неясно отличие от обычного LLM-чата', 'Качество зависит от входных данных'],
    questions: ['Как часто возникает задача?', 'Как измеряется польза?', 'Почему пользователь вернётся?'],
    next_step: 'Проведите пять интервью с представителями целевой аудитории.',
  };
}

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const payload = JSON.parse(body);
    const idea = payload.messages?.at(-1)?.content || '';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseFor(idea)) } }] }));
  });
}).listen(4010, '127.0.0.1', () => console.log('Mock LLM ready on 4010'));
