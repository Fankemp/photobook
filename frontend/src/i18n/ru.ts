import { plural } from './plural.ts'

// Все строки интерфейса. Казахский перевод (позже) — файл kk.ts с теми же ключами.
export const ru = {
  appTitle: 'Фотокниги',
  loading: 'Загружаем…',

  catalog: {
    title: 'Фотокнига в подарок',
    subtitle: 'Выберите шаблон — дальше добавите свои фото и подписи.',
    continueBook: 'Продолжить мою книгу',
  },

  template: {
    back: '← Все шаблоны',
    create: 'Создать книгу по этому шаблону',
    creating: 'Создаём…',
  },

  book: {
    title: 'Моя фотокнига',
    saveLinkHint: 'Сохраните эту ссылку: по ней можно вернуться к книге с любого устройства.',
    copy: 'Копировать',
    copied: 'Скопировано',
    toCatalog: 'К шаблонам',
    cover: 'Обложка',
    page: (n: number) => `Страница ${n}`,
  },

  // «Квадрат 20×20 см · 20 страниц»
  formatInfo: (formatName: string, pages: number) =>
    `${formatName} · ${pages} ${plural(pages, ['страница', 'страницы', 'страниц'])}`,

  occasions: {
    anniversary: 'Годовщина',
    birthday: 'День рождения',
    travel: 'Путешествие',
    mom: 'Подарок маме',
    wedding: 'Свадьба',
    baby: 'Малыш',
    family: 'Семья',
    other: 'Другое',
  } as Record<string, string>,

  notFound: {
    title: 'Страница не найдена',
    home: 'На главную',
  },

  // Ключи — коды ошибок из API (поле "error"), плюс "network" и "internal".
  errors: {
    network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    internal: 'Что-то пошло не так. Попробуйте ещё раз чуть позже.',
    template_not_found: 'Шаблон не найден.',
    book_not_found: 'Книга не найдена. Проверьте ссылку.',
    bad_request: 'Некорректный запрос.',
  },
}

export type Dict = typeof ru
